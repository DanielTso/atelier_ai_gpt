/** Time-of-day greeting prefix. Hours 5–11 morning, 12–16 afternoon, else evening. */
export function greetingForHour(hour: number): string {
  if (hour >= 5 && hour <= 11) return 'Good morning'
  if (hour >= 12 && hour <= 16) return 'Good afternoon'
  return 'Good evening'
}
