import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx'

/** Minimal Markdown → docx: #/##/### headings, '- ' bullets, blank-line paragraphs. */
export async function toDocx(markdown: string): Promise<Buffer> {
  const children: Paragraph[] = []
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (!line.trim()) { children.push(new Paragraph({})); continue }
    const h = /^(#{1,3})\s+(.*)$/.exec(line)
    if (h) {
      const level = h[1].length === 1 ? HeadingLevel.HEADING_1 : h[1].length === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
      children.push(new Paragraph({ heading: level, children: [new TextRun(h[2])] }))
      continue
    }
    const b = /^[-*]\s+(.*)$/.exec(line)
    if (b) { children.push(new Paragraph({ text: b[1], bullet: { level: 0 } })); continue }
    children.push(new Paragraph({ children: [new TextRun(line)] }))
  }
  const doc = new Document({ sections: [{ children }] })
  return await Packer.toBuffer(doc)
}
