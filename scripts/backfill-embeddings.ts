// Embeds chat messages that have no message_embeddings row (handoff 2026-11-12
// item 4). An operator step, never part of the app's request path:
//
//   npx -y tsx --env-file=.env.local scripts/backfill-embeddings.ts --dry-run
//   npx -y tsx --env-file=.env.local scripts/backfill-embeddings.ts --since 2026-10-16 --limit 200
//
// .env.local points at PRODUCTION: running it without --dry-run calls Gemini and
// writes to the live database, which is an owner-approved release step.
import { BACKFILL_USAGE, parseBackfillArgs, type BackfillArgs } from '../src/lib/embeddingBackfillArgs'

async function main(): Promise<number> {
  let args: BackfillArgs
  try {
    args = parseBackfillArgs(process.argv.slice(2))
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    console.error(BACKFILL_USAGE)
    return 2
  }
  if (args.help) {
    console.log(BACKFILL_USAGE)
    return 0
  }

  // Imported only now: the database client throws at import without DATABASE_URL,
  // and --help or a bad flag should not need one.
  const { backfillMissingEmbeddings, countMissingEmbeddings } = await import('../src/lib/embeddingBackfill')
  const scope = args.since ? ` since ${args.since.toISOString()}` : ''

  if (args.dryRun) {
    const remaining = await countMissingEmbeddings(args.since)
    console.log(JSON.stringify({ dryRun: true, remaining }))
    console.log(`${remaining} message(s) missing an embedding${scope}. No embedding calls were made.`)
    return 0
  }

  const result = await backfillMissingEmbeddings({ since: args.since, limit: args.limit })
  console.log(JSON.stringify(result))
  console.log(`Embedded ${result.embedded}, failed ${result.failed}, skipped ${result.skipped}; ${result.remaining} still missing${scope}.`)
  if (result.skipped > 0) {
    console.error('Stopped early: the embedding provider failed several times in a row and looks down. Check the Gemini key and quota before running again.')
    return 1
  }
  return result.failed > 0 ? 1 : 0
}

main().then(
  code => process.exit(code),
  err => {
    // Messages only (no stack, no error object): Drizzle wraps the driver error,
    // whose `cause` says why (e.g. ECONNREFUSED).
    const cause = err instanceof Error && err.cause instanceof Error ? ` (cause: ${err.cause.message})` : ''
    console.error('Backfill failed:', err instanceof Error ? err.message : String(err), cause)
    process.exit(1)
  },
)
