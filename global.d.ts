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
  export function render(template: string, data?: Record<string, unknown>, options?: Options): string | Promise<string>

  const ejs: {
    compile: typeof compile
    render: typeof render
  }

  export default ejs
}
