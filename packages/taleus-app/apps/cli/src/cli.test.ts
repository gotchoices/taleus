import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import { formatAmount, parseAmount, UNITS } from './amount.ts'
import { find } from './commands/index.ts'
import { splitArgv, splitLine } from './lex.ts'
import { createOutput, escapeField } from './output.ts'
import { RefError, resolveRef } from './refs.ts'

void describe('command lines', () => {
	void it('splits words, quotes, escapes and commands', () => {
		assert.deepEqual(splitLine(`pay 1 12.50 "lunch; dessert" ; tallies`), [['pay', '1', '12.50', 'lunch; dessert'], ['tallies']])
		assert.deepEqual(splitLine(`pay 2 3 it\\'s 'a "test"'`), [['pay', '2', '3', "it's", 'a "test"']])
		assert.deepEqual(splitLine('  '), [])
		assert.throws(() => splitLine('pay "oops'), /unclosed/)
		assert.deepEqual(splitLine('tallies\n# a comment; not run\nstatus # note\n'), [['tallies'], ['status']])
	})
	void it('splits argv on a lone ;', () => {
		assert.deepEqual(splitArgv(['tallies', ';', 'pay', '1', 'a;b']), [['tallies'], ['pay', '1', 'a;b']])
	})
})

void describe('output', () => {
	void it('keeps a record on one line', () => {
		assert.equal(escapeField('a\tb\nc\\d'), 'a\\tb\\nc\\\\d')
		assert.equal(escapeField(null), '')
		assert.equal(escapeField(true), 'yes')
	})
	void it('writes tab-separated rows, or JSON lines', () => {
		let out = ''
		createOutput({ json: false, header: true, write: text => void (out += text) }).rows(['row', 'memo'], [{ row: 1, memo: 'hi\tthere' }])
		assert.equal(out, 'row\tmemo\n1\thi\\tthere\n')
		out = ''
		createOutput({ json: true, header: true, write: text => void (out += text) }).rows(['row', 'memo'], [{ row: 1 }])
		assert.equal(out, '{"row":1,"memo":null}\n')
	})
})

void describe('amounts, in the tally\'s unit as written', () => {
	void it('reads dollars and CHIPs', () => {
		assert.equal(parseAmount('12.50', UNITS.USD).units, 1250)
		assert.equal(parseAmount('12', UNITS.USD).units, 1200)
		assert.equal(parseAmount('0.5', UNITS.USD).units, 50)
		assert.equal(parseAmount('1.234', UNITS.CHIP).units, 1234)
	})
	void it('refuses what it would have to guess at', () => {
		assert.throws(() => parseAmount('12.345', UNITS.USD), /3 decimal places; USD has 2/)
		assert.throws(() => parseAmount('1,000', UNITS.USD), /not an amount/)
		assert.throws(() => parseAmount('-5', UNITS.USD), /not an amount/)
	})
	void it('writes them back the same way', () => {
		assert.equal(formatAmount(1250, UNITS.USD), '12.50 USD')
		assert.equal(formatAmount(5, UNITS.USD), '0.05 USD')
		assert.equal(formatAmount(-1234, UNITS.CHIP), '-1.234 CHIP')
	})
})

void describe('naming tallies', () => {
	const tallies = [{ id: 'tally-f8f301', title: 'Sam' }, { id: 'tally-f8f3ff', title: 'Mara' }, { id: 'tally-0c1d', title: 'sam' }]
	const last = ['tally-0c1d', 'tally-f8f301']
	void it('by row of the last listing', () => {
		assert.equal(resolveRef('2', tallies, last).id, 'tally-f8f301')
		assert.throws(() => resolveRef('3', tallies, last), RefError)
	})
	void it('by id or unique prefix', () => {
		assert.equal(resolveRef('tally-f8f301', tallies, last).title, 'Sam')
		assert.throws(() => resolveRef('tally-f8f3', tallies, last), /starts 2/)
	})
	void it('by counterparty, when only one tally has it', () => {
		assert.equal(resolveRef('mara', tallies, last).id, 'tally-f8f3ff')
		assert.throws(() => resolveRef('SAM', tallies, last), /2 tallies/)
	})
})

void describe('command names', () => {
	void it('takes a name, an alias, or a unique beginning', () => {
		assert.equal(find('status').name, 'status')
		assert.equal(find('?').name, 'help')
		assert.equal(find('ls').name, 'tallies')
		assert.equal(find('invite').name, 'invite')
		assert.equal(find('hist').name, 'history')
	})
	void it('refuses an ambiguous or unknown word', () => {
		assert.throws(() => find('s'), /could be/)
		assert.throws(() => find('nope'), /no command/)
	})
})
