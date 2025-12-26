export function getInterviewCost(duration: number) {
  if (duration <= 15) return 1
  if (duration <= 30) return 2
  if (duration <= 45) return 3
  return Math.ceil(duration / 15)
}

