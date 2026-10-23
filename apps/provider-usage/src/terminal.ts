export interface AlternateScreenOptions {
  watch: boolean;
  isTTY: boolean;
  json: boolean;
  term: string | undefined;
  noAltScreen: boolean;
}

export function useAlternateScreen(options: AlternateScreenOptions): boolean {
  return (
    options.watch &&
    options.isTTY &&
    !options.json &&
    !options.noAltScreen &&
    options.term !== "dumb"
  );
}

export const isInteractiveTui = useAlternateScreen;
