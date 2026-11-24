/** Value placeholder ('' for a switch) and the text. */
export type ForkFlagHelpLine = readonly [value: string, text: string]

/** By command and flag. */
export type ForkFlagHelp = Record<string, Record<string, ForkFlagHelpLine>>
