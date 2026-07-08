import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import { splitPdfIntoSegments, splitPdfPageRuns } from '@/lib/pdfSegments'

async function makePdf(pages: number): Promise<Buffer> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([200, 200])
    page.drawText(`page ${i + 1}`, { x: 20, y: 100 })
  }
  return Buffer.from(await doc.save())
}

describe('splitPdfIntoSegments', () => {
  it('splits 5 pages into 2-page segments with a remainder', async () => {
    const { segments, pageCount, skippedPages } = await splitPdfIntoSegments(await makePdf(5), 2)
    expect(pageCount).toBe(5)
    expect(skippedPages).toBe(0)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 2], [3, 4], [5, 5]])
    // each segment is a real, loadable PDF with the right page count
    const seg0 = await PDFDocument.load(segments[0].bytes)
    expect(seg0.getPageCount()).toBe(2)
  })

  it('one-page doc yields one segment', async () => {
    const { segments, pageCount } = await splitPdfIntoSegments(await makePdf(1), 20)
    expect(pageCount).toBe(1)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 1]])
  })

  it('applies the page cap before splitting', async () => {
    const { segments, pageCount } = await splitPdfIntoSegments(await makePdf(5), 2, { maxPages: 3 })
    expect(pageCount).toBe(5)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 2], [3, 3]])
  })

  it('recursively halves an oversize segment down to single pages', async () => {
    // Establish a threshold between a 1-page and a 4-page segment size.
    const onePage = await splitPdfIntoSegments(await makePdf(1), 1)
    const onePageBytes = onePage.segments[0].bytes.length
    const { segments, skippedPages } = await splitPdfIntoSegments(await makePdf(4), 4, {
      maxSegmentBytes: onePageBytes + 200, // 4-page segment is over; single pages are under
    })
    expect(skippedPages).toBe(0)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 1], [2, 2], [3, 3], [4, 4]])
  })

  it('skips (and counts) single pages that exceed the byte cap', async () => {
    const { segments, skippedPages } = await splitPdfIntoSegments(await makePdf(3), 2, { maxSegmentBytes: 10 })
    expect(segments).toEqual([])
    expect(skippedPages).toBe(3)
  })
})

describe('splitPdfPageRuns', () => {
  it('groups contiguous pages into run segments', async () => {
    const { segments, skippedPages } = await splitPdfPageRuns(await makePdf(10), [2, 3, 7, 8, 9])
    expect(skippedPages).toBe(0)
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[2, 3], [7, 9]])
  })

  it('chunks a long run at pagesPerSegment', async () => {
    const { segments } = await splitPdfPageRuns(await makePdf(8), [1, 2, 3, 4, 5, 6], { pagesPerSegment: 4 })
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[1, 4], [5, 6]])
  })

  it('sorts and dedupes the page list', async () => {
    const { segments } = await splitPdfPageRuns(await makePdf(6), [5, 2, 2, 4, 5])
    expect(segments.map(s => [s.firstPage, s.lastPage])).toEqual([[2, 2], [4, 5]])
  })

  it('applies the byte cap with skip accounting', async () => {
    const { segments, skippedPages } = await splitPdfPageRuns(await makePdf(4), [1, 2], { maxSegmentBytes: 10 })
    expect(segments).toEqual([])
    expect(skippedPages).toBe(2)
  })
})
