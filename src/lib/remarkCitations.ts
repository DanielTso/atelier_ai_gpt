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
import {
  splitOnCitations,
  normalizeCitationText,
  LOOSE_CITE_RE,
  type Citation,
} from './citations'

// Display-layer strip (locked design: splitOnCitations stays pure — the
// strip decision lives here in the renderer). A token matching LOOSE_CITE_RE
// that survived normalize + split is an INTENDED citation that still fails the
// grammar → spec says it never renders as literal text. Truly arbitrary
// bracket text (no cite prefix + digits) doesn't match and stays untouched.
function stripLooseCites(value: string): string {
  return value.replace(new RegExp(LOOSE_CITE_RE.source, 'g'), '')
}

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
      // Near-miss markers (en-dash ranges, p-dot pages) normalize to canonical
      // grammar BEFORE splitting so they render as chips instead of leaking.
      const normalized = normalizeCitationText(node.value)
      const runs = splitOnCitations(normalized)
      // No parseable markers: still strip any remaining loose (cite-intended
      // but malformed) tokens; if nothing changed, leave the node untouched.
      if (runs.length === 1 && runs[0].type === 'text') {
        const stripped = stripLooseCites(runs[0].value)
        if (stripped === node.value) return
        if (stripped === '') {
          parent.children.splice(index, 1)
          return index
        }
        node.value = stripped
        return
      }

      const replacement = runs
        .map((run): Run => (run.type === 'text' ? { type: 'text', value: stripLooseCites(run.value) } : run))
        .filter((run) => run.type !== 'text' || run.value !== '')
        .map(toReplacementNode)
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
