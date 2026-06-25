import { describe, it, expect } from 'vitest'
import { filterArtifacts } from '@/lib/artifactFilter'

const A = [
  { id: 1, title: 'Quarterly Report', type: 'pdf', chatTitle: 'Finance chat', projectName: null },
  { id: 2, title: 'Landing Page', type: 'html', chatTitle: null, projectName: 'Marketing' },
  { id: 3, title: 'Budget', type: 'xlsx', chatTitle: 'Finance chat', projectName: null },
]

describe('filterArtifacts', () => {
  it('returns all when query empty and type all', () => {
    expect(filterArtifacts(A, { query: '', type: 'all' })).toHaveLength(3)
  })
  it('filters by type', () => {
    expect(filterArtifacts(A, { query: '', type: 'html' }).map(a => a.id)).toEqual([2])
  })
  it('matches title case-insensitively', () => {
    expect(filterArtifacts(A, { query: 'budget', type: 'all' }).map(a => a.id)).toEqual([3])
  })
  it('matches source chip text (chatTitle / projectName)', () => {
    expect(filterArtifacts(A, { query: 'finance', type: 'all' }).map(a => a.id)).toEqual([1, 3])
    expect(filterArtifacts(A, { query: 'marketing', type: 'all' }).map(a => a.id)).toEqual([2])
  })
  it('combines query and type (AND)', () => {
    expect(filterArtifacts(A, { query: 'finance', type: 'xlsx' }).map(a => a.id)).toEqual([3])
  })
  it('trims whitespace-only query to no-op', () => {
    expect(filterArtifacts(A, { query: '   ', type: 'all' })).toHaveLength(3)
  })
})
