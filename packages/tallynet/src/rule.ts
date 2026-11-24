/**
 * A tiny rule engine: named async checks with optional dependencies and conditions, evaluated once
 * each and collected into an explainable pass/fail list. Discovery uses it to validate an inbound
 * query (session code valid, plan shape consistent, …) and report *which* rule rejected it rather
 * than a bare boolean. Ported from ChipNet's `rule.ts`; behaviour preserved, retyped to avoid
 * `any` and to format thrown errors safely.
 *
 * Evaluation order follows the `rules` array, but a rule's dependencies are evaluated first (and
 * memoised): if a dependency fails, the dependent fails with `Dependency failed: <name>`; a named
 * dependency that does not exist fails the dependent with `Missing dependency: <name>`. A rule
 * whose own `condition` returns false is skipped and omitted from the results. A rule whose `test`
 * throws fails with the error's message. See the NOTE on the memoised-skip asymmetry below.
 */

export interface RuleResponse {
	passed: boolean
	message: string
}

export interface RuleResult {
	name: string
	passed: boolean
	message: string
}

/** The constraint for a rule's test: any function returning a `Promise<RuleResponse>`. */
type RuleTest = (...args: never[]) => Promise<RuleResponse>

export class Rule<TF extends RuleTest> {
	constructor(
		public readonly name: string,
		public readonly test: TF,
		public readonly options: {
			dependencies?: string[]
			condition?: (...args: Parameters<TF>) => boolean
		} = {},
	) {}
}

export class RuleSet<TF extends RuleTest> {
	constructor(public readonly rules: Rule<TF>[]) {}

	private async evaluateRule(
		rule: Rule<TF>,
		results: Map<string, RuleResult | null>,
		...args: Parameters<TF>
	): Promise<RuleResult | null> {
		// Evaluate (and memoise) this rule's dependencies first.
		if (rule.options.dependencies) {
			for (const depName of rule.options.dependencies) {
				if (!results.has(depName)) {
					const depRule = this.rules.find((r) => r.name === depName)
					if (depRule) {
						const depResult = await this.evaluateRule(depRule, results, ...args)
						results.set(depName, depResult)
						if (depResult && !depResult.passed) {
							return { name: rule.name, passed: false, message: `Dependency failed: ${depName}` }
						}
					} else {
						return { name: rule.name, passed: false, message: `Missing dependency: ${depName}` }
					}
				} else if (!results.get(depName)) {
					// NOTE: faithful to ChipNet, order-dependent and quirky — preserved as-is; the
					// discovery/consensus tickets that build real RuleSets may choose to normalise it.
					// (1) A dependency found already-skipped in the memo skips this rule, but one freshly
					//     evaluated to skipped (above) does not. (2) Dependency-*failure* only propagates
					//     ("Dependency failed") when the dependency is evaluated lazily here; a dependency
					//     ordered earlier in the array (already memoised as failed) does NOT fail the
					//     dependent, because this branch only tests the skip (null) case, not failure.
					return null
				}
			}
		}

		// Skip when the rule's own condition is false.
		if (rule.options.condition && !rule.options.condition(...args)) {
			return null
		}

		try {
			const { passed, message } = await rule.test(...args)
			return { name: rule.name, passed, message }
		} catch (error) {
			return { name: rule.name, passed: false, message: `Error: ${formatError(error)}` }
		}
	}

	/** Evaluate every rule once, returning results for those that ran (skipped rules are omitted). */
	public async run(...args: Parameters<TF>): Promise<RuleResult[]> {
		const results = new Map<string, RuleResult | null>()
		for (const rule of this.rules) {
			if (!results.has(rule.name)) {
				results.set(rule.name, await this.evaluateRule(rule, results, ...args))
			}
		}
		return Array.from(results.values()).filter((result): result is RuleResult => result !== null)
	}

	/** Run the rules and throw if any failed, joining the failed rules' messages. */
	public async runAndCheck(...args: Parameters<TF>): Promise<void> {
		checkRules(await this.run(...args))
	}
}

/** Throw the failed rules' messages, joined, if any rule failed. */
export function checkRules(rules: RuleResult[]): void {
	const failed = rules.filter((rule) => !rule.passed)
	if (failed.length > 0) {
		throw new Error(failed.map((rule) => rule.message).join('\r\n'))
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}
