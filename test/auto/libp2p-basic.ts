/*
  Basic libp2p Stream Communication Test
  
  This test validates that we can send and receive JSON data correctly
  over libp2p streams before testing the complex state machine logic.
*/

import { strict as assert } from 'assert'
import { describe, it, beforeAll, afterAll } from 'vitest'
import { createLibp2p, Libp2p } from 'libp2p'
import { tcp } from '@libp2p/tcp'
import { noise } from '@chainsafe/libp2p-noise'
import { mplex } from '@libp2p/mplex'

const TEST_PROTOCOL = '/test/json/1.0.0'

// Stream interface
interface LibP2PStream {
  source: AsyncIterable<Uint8Array>
  sink(source: AsyncIterable<Uint8Array>): Promise<void>
  closeWrite?(): void
  close?(): void
}

// Simple JSON utilities (corrected libp2p stream usage)
async function writeJsonToStream(stream: LibP2PStream, obj: unknown): Promise<void> {
  const jsonData = JSON.stringify(obj)
  console.log('[writeJson] Sending:', jsonData)
  const encoded = new TextEncoder().encode(jsonData)
  console.log('[writeJson] Encoded bytes:', encoded.length)
  
  // Correct libp2p stream writing
  const writer = stream.sink
  await writer([encoded])
}

async function readJsonFromStream(stream: LibP2PStream): Promise<unknown> {
  const decoder = new TextDecoder()
  let message = ''
  
  console.log('[readJson] Starting to read...')
  for await (const chunk of stream.source) {
    console.log('[readJson] Received chunk with', chunk.length, 'subchunks')
    for (const subChunk of chunk) {
      message += decoder.decode(subChunk, { stream: true })
    }
  }
  
  console.log('[readJson] Decoded text:', JSON.stringify(message))
  
  if (!message.trim()) {
    throw new Error('No data received')
  }
  
  return JSON.parse(message)
}

function createLibp2pNode(port: number = 0): Promise<Libp2p> {
  return createLibp2p({
    addresses: {
      listen: [`/ip4/127.0.0.1/tcp/${port}`]
    },
    transports: [tcp()],
    connectionEncrypters: [noise()],
    streamMuxers: [mplex()],
    connectionManager: {
      dialTimeout: 5000
    }
  })
}

describe('libp2p Basic Stream Communication', () => {
  let nodeA: Libp2p
  let nodeB: Libp2p
  
  beforeAll(async () => {
    nodeA = await createLibp2pNode()
    nodeB = await createLibp2pNode()
    await nodeA.start()
    await nodeB.start()
  })
  
  afterAll(async () => {
    await nodeA?.stop()
    await nodeB?.stop()
  })

  it('should send and receive simple JSON object', async () => {
    const testData = { message: 'hello', number: 42 }
    let receivedData: any = null
    
    // A listens for incoming streams
    nodeA.handle(TEST_PROTOCOL, async ({ stream }) => {
      console.log('[Listener] Received stream')
      try {
        receivedData = await readJsonFromStream(stream as LibP2PStream)
        console.log('[Listener] Received data:', receivedData)
      } catch (error) {
        console.error('[Listener] Error:', error)
        throw error
      }
    })
    
    // B connects and sends data
    console.log('[Dialer] Connecting to A...')
    const stream = await nodeB.dialProtocol(
      nodeA.getMultiaddrs()[0], 
      TEST_PROTOCOL
    ) as LibP2PStream
    
    console.log('[Dialer] Sending data...')
    await writeJsonToStream(stream, testData)
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Verify
    assert.deepEqual(receivedData, testData)
    
    // Cleanup
    nodeA.unhandle(TEST_PROTOCOL)
  }, 10000)

  it('should handle larger JSON objects', async () => {
    const testData = {
      token: 'test-token-12345',
      partyId: 'party-abc-123',
      identityBundle: {
        did: 'did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        publicKey: 'z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK',
        metadata: { nodeType: 'client', version: '1.0.0' }
      },
      cadrePeerAddrs: [
        '/ip4/192.168.1.100/tcp/4001/p2p/12D3KooWExample1',
        '/ip4/192.168.1.101/tcp/4001/p2p/12D3KooWExample2'
      ]
    }
    let receivedData: any = null
    
    // A listens for incoming streams
    nodeA.handle(TEST_PROTOCOL, async ({ stream }) => {
      console.log('[Listener] Received stream')
      receivedData = await readJsonFromStream(stream as LibP2PStream)
      console.log('[Listener] Received data keys:', Object.keys(receivedData))
    })
    
    // B connects and sends data
    const stream = await nodeB.dialProtocol(
      nodeA.getMultiaddrs()[0], 
      TEST_PROTOCOL
    ) as LibP2PStream
    
    await writeJsonToStream(stream, testData)
    
    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Verify
    assert.deepEqual(receivedData, testData)
    
    // Cleanup
    nodeA.unhandle(TEST_PROTOCOL)
  }, 10000)

  it('should handle bidirectional communication', async () => {
    const requestData = { action: 'provision', role: 'stock' }
    const responseData = { approved: true, dbConnectionInfo: 'mock-db-info' }
    let receivedResponse: any = null
    
    // A listens and responds
    nodeA.handle(TEST_PROTOCOL, async ({ stream }) => {
      console.log('[Listener] Received stream')
      const request = await readJsonFromStream(stream as LibP2PStream)
      console.log('[Listener] Received request:', request)
      
      // Send response
      await writeJsonToStream(stream, responseData)
      console.log('[Listener] Sent response')
    })
    
    // B connects, sends request, and receives response
    const stream = await nodeB.dialProtocol(
      nodeA.getMultiaddrs()[0], 
      TEST_PROTOCOL
    ) as LibP2PStream
    
    await writeJsonToStream(stream, requestData)
    console.log('[Dialer] Sent request')
    
    receivedResponse = await readJsonFromStream(stream)
    console.log('[Dialer] Received response:', receivedResponse)
    
    // Verify
    assert.deepEqual(receivedResponse, responseData)
    
    // Cleanup
    nodeA.unhandle(TEST_PROTOCOL)
  }, 10000)
})
