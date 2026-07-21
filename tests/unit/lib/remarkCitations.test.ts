import { describe, it, expect } from 'vitest'
import remarkCitations from '@/lib/remarkCitations'
import type { Root, Paragraph, Text } from 'mdast'

function textNode(value: string): Text {
  return { type: 'text', value }
}

function paragraph(children: Text[]): Paragraph {
  return { type: 'paragraph', children }
}

function root(children: Paragraph[]): Root {
  return { type: 'root', children }
}

describe('remarkCitations', () => {
  it('leaves text without markers untouched', () => {
    const tree = root([paragraph([textNode('no markers here')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    expect(para.children).toHaveLength(1)
    expect(para.children[0]).toEqual({ type: 'text', value: 'no markers here' })
  })

  it('splits a text node with two markers into interleaved text/chip nodes, in order', () => {
    const tree = root([paragraph([textNode('See [cite:1 p2] and also [cite:3 c9] for detail.')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    const nodes = para.children as unknown as Array<{
      type: string
      value?: string
      data?: { hName: string; hProperties: Record<string, unknown> }
    }>

    expect(nodes.map((n) => n.type)).toEqual(['text', 'citation', 'text', 'citation', 'text'])

    expect(nodes[0].value).toBe('See ')
    expect(nodes[1].data?.hName).toBe('citation-chip')
    expect(nodes[1].data?.hProperties).toEqual({ docId: 1, page: 2, raw: '[cite:1 p2]' })
    expect(nodes[2].value).toBe(' and also ')
    expect(nodes[3].data?.hProperties).toEqual({ docId: 3, chunkId: 9, raw: '[cite:3 c9]' })
    expect(nodes[4].value).toBe(' for detail.')
  })

  it('handles a marker at the very start and end of the text node', () => {
    const tree = root([paragraph([textNode('[cite:5] leading and trailing [cite:6 p1-3]')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    const nodes = para.children as unknown as Array<{ type: string; value?: string }>
    expect(nodes.map((n) => n.type)).toEqual(['citation', 'text', 'citation'])
    expect(nodes[1].value).toBe(' leading and trailing ')
  })

  it('normalizes a near-miss token (p-dot + en-dash range) into a chip node', () => {
    const tree = root([paragraph([textNode('See sheet [cite:1 p.34–36] here.')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    const nodes = para.children as unknown as Array<{
      type: string
      value?: string
      data?: { hName: string; hProperties: Record<string, unknown> }
    }>
    expect(nodes.map((n) => n.type)).toEqual(['text', 'citation', 'text'])
    expect(nodes[1].data?.hName).toBe('citation-chip')
    expect(nodes[1].data?.hProperties).toEqual({
      docId: 1,
      page: 34,
      pageEnd: 36,
      raw: '[cite:1 p34-36]',
    })
    expect(nodes[0].value).toBe('See sheet ')
    expect(nodes[2].value).toBe(' here.')
  })

  it('REMOVES an unparseable-but-cite-intended token from the text run', () => {
    const tree = root([paragraph([textNode('Fact [cite:1 x9] and cited [cite:2].')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    const nodes = para.children as unknown as Array<{ type: string; value?: string }>
    expect(nodes.map((n) => n.type)).toEqual(['text', 'citation', 'text'])
    // '[cite:1 x9]' never renders — stripped from the surrounding text run.
    expect(nodes[0].value).toBe('Fact  and cited ')
    expect(nodes[2].value).toBe('.')
  })

  it('strips a cite-intended token even when the node has no parseable marker', () => {
    const tree = root([paragraph([textNode('Only a bad one [cite: 12] remains.')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    expect(para.children).toHaveLength(1)
    expect(para.children[0]).toEqual({ type: 'text', value: 'Only a bad one  remains.' })
  })

  it('removes the text node entirely when it is nothing but a malformed cite token', () => {
    const tree = root([paragraph([textNode('[cite:9 p]')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    expect(para.children).toHaveLength(0)
  })

  it('preserves truly arbitrary bracket text (no cite prefix + digits)', () => {
    const tree = root([paragraph([textNode('A claim [citation needed] and [cite:abc] stay.')])])
    remarkCitations()(tree)
    const para = tree.children[0] as Paragraph
    expect(para.children).toHaveLength(1)
    expect(para.children[0]).toEqual({
      type: 'text',
      value: 'A claim [citation needed] and [cite:abc] stay.',
    })
  })
})
