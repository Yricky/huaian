declare module '*.css'

declare module 'ejs' {
  export interface Options {
    async?: boolean
    client?: boolean
    outputFunctionName?: string
    _with?: boolean
    localsName?: string
    strict?: boolean
    rmWhitespace?: boolean
  }

  export function compile(template: string, options?: Options): unknown

  const ejs: {
    compile: typeof compile
  }

  export default ejs
}
