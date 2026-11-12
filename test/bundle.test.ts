/**
 * The built client bundle is what actually ships, so it is tested as a bundle: it must
 * register under the package name, require nothing the shell does not seed, and contribute
 * exactly one slot entry.
 */
import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

const root = join(import.meta.dir, '..')
const nodeRequire = createRequire(join(root, 'package.json'))

/** The handful of DOM members the client touches, plus a head that remembers its children. */
function element(children: any[] = []) {
  return {
    dataset: {} as Record<string, string>,
    style: {} as Record<string, string>,
    textContent: '',
    className: '',
    append(...nodes: any[]) {
      children.push(...nodes)
    },
    appendChild(node: any) {
      children.push(node)
    },
    remove() {},
    setAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
    get text() {
      return children.map((child) => child.textContent).join('')
    },
  }
}

/** Evaluate lib/client.js the way the shell's module loader would. */
function materialize() {
  const head = element()
  const documentStub = {
    documentElement: element(),
    head,
    body: element(),
    createElement: () => element(),
    querySelector: () => null,
    addEventListener() {},
    removeEventListener() {},
  }
  const windowStub: Record<string, any> = {
    document: documentStub,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
  }
  windowStub.__ModuleLoader__ = {
    load(registration: any) {
      windowStub.__registration = registration
    },
  }

  const code = readFileSync(join(root, 'lib/client.js'), 'utf8')
  new Function('window', 'document', 'globalThis', code).call(windowStub, windowStub, documentStub, globalThis)

  const registration = windowStub.__registration
  if (!registration) throw new Error('bundle did not call __ModuleLoader__.load')

  const required: string[] = []
  const shim = (spec: string) => {
    required.push(spec)
    if (spec === 'react') return nodeRequire('react')
    if (spec === 'react/jsx-runtime') return nodeRequire('react/jsx-runtime')
    if (spec === 'react-dom') return nodeRequire('react-dom')
    if (spec === 'react-dom/client') return nodeRequire('react-dom/client')
    if (spec === '@deepseek-ai/cordis') return {}
    // The shell's markdown renderer: a platform seed, stubbed to prove the bundle loads.
    if (spec === '@deepseek-ai/dsh-client-ui-primitives') return { MarkdownText: () => null }
    throw new Error(`require("${spec}") is not a platform seed`)
  }

  const exports = registration.factory(shim) as {
    apply(ctx: unknown): void
    inject: string[]
    name: string
  }
  return { registration, exports, required, document: documentStub }
}

describe('client bundle', () => {
  test('registers under the package name the boot graph expects', () => {
    expect(materialize().registration.id).toBe('dsh-genui')
  })

  test('requires only modules the shell seeds', () => {
    const { required } = materialize()
    expect(new Set(required)).toEqual(
      new Set([
        'react',
        'react/jsx-runtime',
        'react-dom',
        '@deepseek-ai/dsh-client-ui-primitives',
      ]),
    )
  })

  test('exports the plugin face the loader mounts', () => {
    const { exports } = materialize()
    expect(exports.name).toBe('dsh-genui-client')
    expect(exports.inject).toEqual(['slots'])
    expect(typeof exports.apply).toBe('function')
  })

  /**
   * The context surface the plugin touches: effects, slots, the service it publishes, and the
   * optional services it borrows.
   */
  function fakeContext(
    registrations: { options: any; component: unknown }[],
    services: string[] = [],
    provided: Record<string, unknown> = {},
  ) {
    const slots = {
      inject: (_name: string, callback: () => void) => callback(),
      register: (options: unknown, component: unknown) => {
        registrations.push({ options, component })
        return () => {}
      },
    }
    const effects: (() => unknown)[] = []
    const scoped = {
      slots,
      effect: (fn: () => unknown) => {
        effects.push(fn)
        fn()
        return () => {}
      },
      // Borrowing a scope is what the click bridge does. A row painted outside a retained
      // session must get `undefined` rather than a throw, so the fake answers the same way.
      sessions: { scope: () => undefined },
    }
    return {
      effect: (fn: () => unknown) => {
        fn()
        return () => {}
      },
      provide: (name: string, value: unknown) => {
        provided[name] = value
        return () => {}
      },
      provided,
      slots,
      effects,
      inject: (deps: string[], callback: (scoped: unknown) => void) => {
        if (deps.every((dep) => services.includes(dep))) callback(scoped)
      },
    }
  }

  test('publishes the click bridge only when the sessions service is composed', () => {
    // A rendered answer cannot reach a Cordis context, so the plugin lends it the scope the
    // row names. Without that block every `@ToAssistant` a program fires is delivered to
    // nobody: the control paints, takes focus, and does nothing.
    const { exports } = materialize()

    const bare = fakeContext([])
    exports.apply(bare)
    expect(bare.effects).toHaveLength(0)

    const composed = fakeContext([], ['sessions'])
    exports.apply(composed)
    expect(composed.effects).toHaveLength(1)
  })

  test('publishes the extension surface a companion registers into', () => {
    const { exports } = materialize()
    const context = fakeContext([])
    exports.apply(context)
    const service = context.provided.genuiClient as {
      registerQueryTools?: unknown
      registerComponents?: unknown
      registerFrameSource?: unknown
    }
    expect(typeof service.registerQueryTools).toBe('function')
    expect(typeof service.registerComponents).toBe('function')
    expect(typeof service.registerFrameSource).toBe('function')
  })

  test('shadows the assistant row instead of adding a second one', () => {
    const { exports, document } = materialize()
    const registrations: { options: any; component: unknown }[] = []
    exports.apply(fakeContext(registrations))
    expect(registrations).toHaveLength(1)
    expect(registrations[0].options).toMatchObject({
      name: 'conversation.chat.node',
      key: 'assistant-step',
      priority: -1,
    })
    expect(typeof registrations[0].component).toBe('function')
    // One stylesheet carries OpenUI's own CSS and the plugin's rules. No theme attribute:
    // the plugin reads the shell's `--dsw-*` tokens instead of latching OpenUI to dark, so a
    // light shell does not grow dark cards.
    expect(document.documentElement.dataset.openuiTheme).toBeUndefined()
    expect((document.head as any).text).toContain('--openui-text-neutral-primary: var(--dsw-alias-label-primary')
  })

  test('the fullscreen viewer sizes its picture instead of letting it overflow', () => {
    // The overlay element carries both the attribute and the class, so its rules must be a
    // compound selector. A descendant selector matched nothing, the picture kept its natural
    // size and a tall render ran off the screen — which reads as the viewer cropping it.
    const { exports, document } = materialize()
    exports.apply(fakeContext([]))
    const css = String((document.head as any).text)
    expect(css).not.toContain('[data-genui-overlay] .genimg-overlay > img')
    expect(css).toContain('[data-genui-overlay].genimg-overlay > img')
    expect(css).toMatch(/\[data-genui-overlay\]\.genimg-overlay > img \{[^}]*max-height: 100%/)
  })

  test('adds the settings rows only when the settings transport is composed', () => {
    const { exports } = materialize()

    const withoutSettings: { options: any; component: unknown }[] = []
    exports.apply(fakeContext(withoutSettings))
    expect(withoutSettings.map((registration) => registration.options.name)).toEqual([
      'conversation.chat.node',
    ])

    // Both halves of the transport, or no row: `configForms` alone cannot refresh the form.
    const partial: { options: any; component: unknown }[] = []
    exports.apply(fakeContext(partial, ['configForms']))
    expect(partial.map((registration) => registration.options.name)).toEqual([
      'conversation.chat.node',
    ])

    const withSettings: { options: any; component: unknown }[] = []
    exports.apply(fakeContext(withSettings, ['configForms', 'remote']))
    expect(withSettings.map((registration) => registration.options.name)).toEqual([
      'conversation.chat.node',
      'settings.general.item',
    ])
    expect(withSettings[1].options).toMatchObject({
      name: 'settings.general.item',
      id: 'genui-answer-format',
      order: 40,
    })
    expect(typeof withSettings[1].component).toBe('function')
  })
})
