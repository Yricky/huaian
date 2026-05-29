class MockCanvasContext {
  font = '16px sans-serif'

  measureText(text: string): TextMetrics {
    const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] ?? 16)
    let width = 0
    for (const char of text) width += /[\u3000-\u9fff]/.test(char) ? size : size * 0.56
    return { width } as TextMetrics
  }
}

class MockOffscreenCanvas {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  getContext(): MockCanvasContext {
    return new MockCanvasContext()
  }
}

Object.defineProperty(globalThis, 'OffscreenCanvas', {
  configurable: true,
  value: MockOffscreenCanvas,
})

Object.defineProperty(globalThis, 'requestAnimationFrame', {
  configurable: true,
  value: (callback: FrameRequestCallback): number => window.setTimeout(() => callback(performance.now()), 0),
})

Object.defineProperty(globalThis, 'cancelAnimationFrame', {
  configurable: true,
  value: (handle: number): void => window.clearTimeout(handle),
})
