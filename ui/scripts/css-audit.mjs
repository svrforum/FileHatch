import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import postcss from 'postcss'

const srcDir = path.resolve('src')

async function findCssFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const entryPath = path.join(dir, entry.name)
    if (entry.isDirectory()) return findCssFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.css') ? [entryPath] : []
  }))
  return files.flat()
}

function relative(file) {
  return path.relative(process.cwd(), file).replaceAll('\\', '/')
}

function lineNumber(text, index) {
  return text.slice(0, index).split('\n').length
}

const adminScopes = new Map([
  ['AdminExternalStorages.css', 'admin-external-storages-page'],
  ['AdminLogs.css', 'admin-logs-page'],
  ['AdminSharedFolders.css', 'admin-shared-folders-page'],
  ['AdminSystemInfo.css', 'si-container'],
  ['AdminUserList.css', 'admin-user-list-page'],
])
const adminAnimationPrefixes = new Map([
  ['AdminExternalStorages.css', 'es'],
  ['AdminLogs.css', 'admin-logs-'],
  ['AdminSharedFolders.css', 'admin-shared-folders-'],
  ['AdminSystemInfo.css', 'si-'],
  ['AdminUserList.css', 'admin-user-list-'],
])
const ownedComponentScopes = new Map([
  ['ContextMenu.css', ['context-menu']],
  ['FileInfoPanel.css', ['file-details-panel']],
  ['FileModals.css', ['file-list-modal', 'file-list-modal-overlay']],
  ['MultiSelectBar.css', ['multi-select-bar']],
])

const allowedBreakpoints = new Set(['375', '480', '768', '769', '900'])
const rawColorBaseline = 178
const importantBaseline = 16
const errors = []
const warnings = []
const definitions = new Map()
const usages = []
let rawColorCount = 0
let importantCount = 0
let outlineNoneCount = 0
let viewportHeightCount = 0
let dynamicViewportHeightCount = 0

function isInsideKeyframes(rule) {
  for (let parent = rule.parent; parent; parent = parent.parent) {
    if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) return true
  }
  return false
}

function selectorHasScope(selector, scope) {
  const scopePattern = new RegExp(`\\.${scope}(?![\\w-])`)
  return scopePattern.test(selector)
}

const files = await findCssFiles(srcDir)
const contents = await Promise.all(files.map(async file => ({
  file,
  text: await readFile(file, 'utf8'),
})))

for (const { file, text } of contents) {
  const fileName = path.basename(file)
  const filePath = relative(file)

  if (filePath.startsWith('src/components/')) {
    rawColorCount += (text.match(/#[0-9a-fA-F]{3,8}\b/g) || []).length
  }
  importantCount += (text.match(/!important/g) || []).length
  outlineNoneCount += (text.match(/outline\s*:\s*none\b/g) || []).length
  viewportHeightCount += (text.match(/(?<![\w-])100vh\b/g) || []).length
  dynamicViewportHeightCount += (text.match(/(?<![\w-])100dvh\b/g) || []).length

  const lines = text.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (!/(?<![\w-])100vh\b/.test(lines[index])) continue
    const fallback = lines[index].replace(/\/\*.*?\*\//g, '').trim()
    const expected = fallback.replace(/(?<![\w-])100vh\b/g, '100dvh')
    const nextDeclaration = lines.slice(index + 1).find(line => line.trim() !== '')?.trim()
    if (nextDeclaration !== expected) {
      errors.push(`${filePath}:${index + 1} 100vh 선언 바로 다음에 동일한 100dvh fallback이 없음`)
    }
  }

  for (const match of text.matchAll(/--([\w-]+)\s*:/g)) {
    const token = match[1]
    if (!definitions.has(token)) definitions.set(token, [])
    definitions.get(token).push(filePath)
  }

  for (const match of text.matchAll(/var\(--([\w-]+)/g)) {
    usages.push({ token: match[1], file: filePath, line: lineNumber(text, match.index) })
  }

  for (const match of text.matchAll(/transition\s*:\s*all\b/g)) {
    errors.push(`${filePath}:${lineNumber(text, match.index)} transition: all 사용`)
  }

  if (!filePath.endsWith('styles/global.css')) {
    for (const match of text.matchAll(/z-index\s*:\s*-?\d+/g)) {
      errors.push(`${filePath}:${lineNumber(text, match.index)} raw z-index 사용`)
    }
    for (const match of text.matchAll(/@media\s*\(prefers-color-scheme:/g)) {
      errors.push(`${filePath}:${lineNumber(text, match.index)} data-theme를 우회하는 색상 테마 분기`)
    }
  }

  for (const match of text.matchAll(/@media\s*\([^)]*(?:max|min)-width\s*:\s*(\d+)px[^)]*\)/g)) {
    if (!allowedBreakpoints.has(match[1])) {
      errors.push(`${filePath}:${lineNumber(text, match.index)} 허용 목록 밖 breakpoint ${match[1]}px`)
    }
  }

  const scope = adminScopes.get(fileName)
  if (scope) {
    let root
    try {
      root = postcss.parse(text, { from: filePath })
    } catch (error) {
      errors.push(`${filePath}: CSS 파싱 실패 (${error.reason ?? error.message})`)
    }
    root?.walkRules(rule => {
      if (isInsideKeyframes(rule)) return
      for (const selector of rule.selectors) {
        if (!selectorHasScope(selector, scope)) {
          errors.push(`${filePath}:${rule.source?.start?.line ?? 1} ${selector.trim()}에 .${scope} 범위가 없음`)
        }
      }
    })
    const animationPrefix = adminAnimationPrefixes.get(fileName)
    root?.walkAtRules(/keyframes$/i, atRule => {
      if (!atRule.params.startsWith(animationPrefix)) {
        errors.push(`${filePath}:${atRule.source?.start?.line ?? 1} @keyframes ${atRule.params}에 ${animationPrefix} 접두사가 없음`)
      }
    })
  }

  const ownedScopes = ownedComponentScopes.get(fileName)
  if (ownedScopes && filePath.includes('/filelist/')) {
    let root
    try {
      root = postcss.parse(text, { from: filePath })
    } catch (error) {
      errors.push(`${filePath}: CSS 파싱 실패 (${error.reason ?? error.message})`)
    }
    root?.walkRules(rule => {
      if (isInsideKeyframes(rule)) return
      for (const selector of rule.selectors) {
        if (!ownedScopes.some(ownedScope => selectorHasScope(selector, ownedScope))) {
          errors.push(`${filePath}:${rule.source?.start?.line ?? 1} ${selector.trim()}에 소유 컴포넌트 범위가 없음`)
        }
      }
    })
  }

  const fileImportantCount = (text.match(/!important/g) || []).length
  if (fileImportantCount > 0) {
    warnings.push(`${filePath}: !important ${fileImportantCount}개`)
  }
}

if (rawColorCount > rawColorBaseline) {
  errors.push(`컴포넌트 CSS raw 색상 ${rawColorCount}개: 기준 ${rawColorBaseline}개 초과`)
}

if (importantCount > importantBaseline) {
  errors.push(`전체 !important ${importantCount}개: 기준 ${importantBaseline}개 초과`)
}

for (const usage of usages) {
  if (!definitions.has(usage.token)) {
    errors.push(`${usage.file}:${usage.line} 정의되지 않은 --${usage.token} 사용`)
  }
}

const globalCss = contents.find(({ file }) => relative(file).endsWith('styles/global.css'))?.text ?? ''
if (!/:focus-visible:not\(input,\s*textarea,\s*select\)\s*{[^}]*outline:[^}]*!important/s.test(globalCss)) {
  errors.push('src/styles/global.css: 폼 컨트롤과 중복되지 않는 전역 :focus-visible 접근성 fallback이 없음')
}

const primitivesCss = contents.find(({ file }) => relative(file).endsWith('styles/primitives.css'))?.text ?? ''
for (const requiredPrimitive of ['.fh-modal-overlay', '.fh-modal', '.fh-button', '.fh-form-field']) {
  if (!primitivesCss.includes(requiredPrimitive)) {
    errors.push(`src/styles/primitives.css: 필수 primitive ${requiredPrimitive} 정의가 없음`)
  }
}

console.log(
  `CSS audit: ${files.length}개 파일, ${definitions.size}개 토큰, ${usages.length}개 토큰 사용, ` +
  `raw 색상 ${rawColorCount}개, outline none ${outlineNoneCount}개 검사`,
)
for (const warning of warnings) console.warn(`WARN ${warning}`)

if (errors.length > 0) {
  for (const error of errors) console.error(`ERROR ${error}`)
  console.error(`CSS audit 실패: ${errors.length}개 오류`)
  process.exit(1)
}

console.log('CSS audit 성공')
