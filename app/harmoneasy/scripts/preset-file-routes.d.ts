export function presetFileRoute(path: string): string
export function presetRouteAliases(route: string): string[]
export function presetFilePages<T>(files: [string, T][]): Map<string, T>