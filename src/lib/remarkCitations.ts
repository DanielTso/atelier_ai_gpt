// remark plugin: expands cite markers embedded in mdast `text` nodes into a
// custom `citation` node. Uses `data.hName`/`data.hProperties` — the same
// mechanism mdast-util-to-hast (the machinery under react-markdown) already
// honors for any node type it doesn't otherwise recognize — so each becomes a
// `<citation-chip>` element. MessagesList's react-markdown `components` map
// turns that element into the real CitationChip React component.
//
// `unist-util-visit` and the `mdast`/`unist` ambient types ship as transitive
// deps of react-markdown/remark-gfm (see package-lock.json) and resolve at
// the top-level node_modules — no new dependency added here.
import { visit } from 'unist-util-visit'
import type { Root, Text } from 'mdast'
import { splitOnCitations, type Citation } from './citations'

type Run =
  | { type: 'text'; value: string }
  | { type: 'cite'; cite: Citation; raw: string }

// Not a real mdast node type — carries just enough `data` for
// mdast-util-to-hast's default "unknown node" handler to build a
// `<citation-chip>` element (no children) from `hName`/`hProperties` alone.
interface CitationHastNode {
  type: 'citation'
  data: {
    hName: 'citation-chip'
    hProperties: Record<string, number | string>
  }
}

function toReplacementNode(run: Run): Text | CitationHastNode {
  if (run.type === 'text') return { type: 'text', value: run.value }
  const { cite, raw } = run
  const hProperties: Record<string, number | string> = { docId: cite.docId, raw }
  if (cite.page !== undefined) hProperties.page = cite.page
  if (cite.pageEnd !== undefined) hProperties.pageEnd = cite.pageEnd
  if (cite.chunkId !== undefined) hProperties.chunkId = cite.chunkId
  return { type: 'citation', data: { hName: 'citation-chip', hProperties } }
}

export default function remarkCitations() {
  return (tree: Root) => {
    visit(tree, 'text', (node, index, parent) => {
      if (!parent || index === undefined) return
      const runs = splitOnCitations(node.value)
      // No markers found: splitOnCitations returns the whole string as a
      // single text run — nothing to replace, leave the node untouched.
      if (runs.length === 1 && runs[0].type === 'text') return

      const replacement = runs.map(toReplacementNode)
      // Custom node types aren't part of mdast's Content union — the cast is
      // the accepted escape hatch for remark plugins minting hName/hProperties
      // nodes (mdast-util-to-hast only cares about `type`/`data` at runtime).
      parent.children.splice(index, 1, ...(replacement as unknown as typeof parent.children))
      // Continue walking right after the inserted nodes. They carry no
      // markers of their own (splitOnCitations already extracted them), so
      // revisiting would be a harmless no-op — but skipping past them matches
      // the convention used by other unist-util-visit-based splice plugins.
      return index + replacement.length
    })
  }
}
