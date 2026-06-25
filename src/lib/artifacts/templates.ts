import type { ArtifactType, SheetSpec } from './types'

export interface BlankTemplate {
  title: string
  format: 'html' | 'markdown' | 'sheets'
  content: string
}

const HTML_STARTER = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Untitled</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 3rem; color: #16202a; }
    h1 { font-weight: 600; }
  </style>
</head>
<body>
  <h1>Untitled</h1>
  <p>Start editing this HTML and use Preview to see it live.</p>
</body>
</html>`

const MARKDOWN_STARTER = `# Untitled\n\nStart writing your content here.`

const SHEET_STARTER: SheetSpec[] = [{ name: 'Sheet1', rows: [['Column A', 'Column B'], ['', '']] }]

export function blankArtifactTemplate(type: ArtifactType): BlankTemplate {
  switch (type) {
    case 'html':
      return { title: 'Untitled HTML artifact', format: 'html', content: HTML_STARTER }
    case 'xlsx':
      return { title: 'Untitled Spreadsheet', format: 'sheets', content: JSON.stringify(SHEET_STARTER) }
    case 'docx':
      return { title: 'Untitled Document', format: 'markdown', content: MARKDOWN_STARTER }
    case 'pdf':
      return { title: 'Untitled PDF', format: 'markdown', content: MARKDOWN_STARTER }
    case 'pptx':
      return { title: 'Untitled Slides', format: 'markdown', content: MARKDOWN_STARTER }
  }
}
