// Argument parsing for scripts/backfill-embeddings.ts. Kept apart from
// embeddingBackfill.ts so `--help` and bad flags are handled before anything
// imports the database client (which throws without DATABASE_URL).

export interface BackfillArgs {
  since: Date | undefined
  limit: number
  dryRun: boolean
  help: boolean
}

// Same bound as BACKFILL_MAX_LIMIT in embeddingBackfill.ts (not imported, see above).
const MAX_LIMIT = 1000

export const BACKFILL_USAGE = `Usage: npx -y tsx --env-file=.env.local scripts/backfill-embeddings.ts [options]

Embeds chat messages that have no message_embeddings row, oldest first.

Options:
  --since <ISO date>  only messages created at or after this time
  --limit <N>         messages to embed this run, 1-${MAX_LIMIT} (default 200)
  --dry-run           report how many messages are missing; no embedding calls
  -h, --help          show this help`

export function parseBackfillArgs(argv: string[]): BackfillArgs {
  const args: BackfillArgs = { since: undefined, limit: 200, dryRun: false, help: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const eq = arg.indexOf('=')
    const flag = arg.startsWith('--') && eq > 0 ? arg.slice(0, eq) : arg
    const takeValue = (): string => {
      if (eq > 0 && flag !== arg) return arg.slice(eq + 1)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('-')) throw new Error(`${flag} needs a value`)
      i++
      return next
    }
    switch (flag) {
      case '--since': {
        const value = takeValue()
        const date = new Date(value)
        if (Number.isNaN(date.getTime())) throw new Error(`--since: not a date: ${value}`)
        args.since = date
        break
      }
      case '--limit': {
        const value = takeValue()
        const n = Number(value)
        if (!/^\d+$/.test(value) || n < 1 || n > MAX_LIMIT) throw new Error(`--limit: expected an integer from 1 to ${MAX_LIMIT}, got ${value}`)
        args.limit = n
        break
      }
      case '--dry-run':
        args.dryRun = true
        break
      case '-h':
      case '--help':
        args.help = true
        break
      default:
        throw new Error(`Unknown option: ${arg}`)
    }
  }
  return args
}
