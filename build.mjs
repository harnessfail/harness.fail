// Builds the published site in docs/ from the sources:
//   data/record.json  the Record, the main data (published as record.json)
//   data/matrix.json  the capability matrix (published as matrix.json)
//   data/shifts.json  the landscape shifts
//   src/index.html    the page: structure only, with build placeholders
//   src/assets/       stylesheet and script (minified on the way out)
// Run with `npm run build`; `npm run check` validates the data, then checks
// formatting with Prettier.

import { execFileSync } from 'node:child_process'
import {
  cpSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { build } from 'esbuild'

import record from './data/record.json' with { type: 'json' }
import matrix from './data/matrix.json' with { type: 'json' }
import shiftsFile from './data/shifts.json' with { type: 'json' }

// Every other path below is relative to the repository root, so the script
// works from any directory.
process.chdir(import.meta.dirname)

const OUT = 'docs'
const { shifts } = shiftsFile

// ---- validation -------------------------------------------------------------
// The JSON is the main record, so it is checked before anything is written.
const FIX_STATUSES = new Set([
  'fixed',
  'partial',
  'disputed',
  'declined',
  'unknown',
  'n/a',
])
const ID = /^[a-z0-9]+(-[a-z0-9]+)*$/
const GROUP_ID = /^[A-Z]$/
const REQUIREMENT_ID = /^[A-Z]\d+$/
// Issues may be dated to the year or month; everything else to the day.
const DATE = /^\d{4}(-\d{2}(-\d{2})?)?$/
const DAY = /^\d{4}-\d{2}-\d{2}$/
const CVE = /CVE-\d{4}-\d+/g
// A bare DOI (no https://doi.org/ prefix): the build adds the resolver link.
const DOI = /^10\.\d{4,}\/[^\s"<>]+$/
// Every link the page renders: https only, and nothing that could end the
// href attribute or the Markdown link it was written in.
const SAFE_URL = /^https:\/\/[^\s"<>()]+$/
// [text](url) inside a text field.
const MARKDOWN_LINK = /\[([^\]]+)\]\(([^)\s]*)\)/g
// Keys an issue may carry; anything else is a typo that would vanish.
const ISSUE_KEYS = new Set([
  'id',
  'class',
  'title',
  'url',
  'credit',
  'cves',
  'date',
  'harnesses',
  'fail',
  'fix',
  'featured',
])
const FIX_KEYS = new Set(['status', 'text'])
const CLASS_KEYS = new Set([
  'id',
  'name',
  'attribution',
  'quote',
  'description',
  'mappings',
])
const MAPPING_LISTS = new Set(['owasp', 'atlas'])
const MAPPING_KEYS = new Set(['id', 'name', 'url'])
// A fix needs its text, except where there is nothing to say.
const FIX_WITHOUT_TEXT = new Set(['unknown', 'n/a'])
// Issues shown per class before the rest fold (see the Record below).
const VISIBLE = 7

const MARKS = {
  y: ['●', 'yes, documented'],
  p: ['◐', 'partial'],
  n: ['○', 'no'],
  u: ['?', 'undocumented'],
  na: ['—', 'not applicable'],
}

const isHttps = url =>
  typeof url === 'string' && SAFE_URL.test(url) && URL.canParse(url)
// Today in local time, the same form the pre-commit hook stamps.
const TODAY = new Date().toLocaleDateString('sv-SE')
// The pattern checks the shape; the round trip rejects dates that do not
// exist (2026-02-30 would otherwise render as March 2). As text, a partial
// date compares below any day in its own month or year, so the last check
// rejects only dates after today.
const isRealDate = date =>
  DATE.test(date ?? '') &&
  !Number.isNaN(Date.parse(date)) &&
  new Date(date).toISOString().startsWith(date) &&
  date <= TODAY
const isDay = date => DAY.test(date ?? '') && isRealDate(date)

// Each validator collects "where: message" lines and returns them.
const problemList = () => {
  const errors = []
  const fail = (where, message) => errors.push(`${where}: ${message}`)
  // Keys outside the allowed set are typos that would silently vanish.
  const checkKeys = (where, object, allowed, label) => {
    const unknown = Object.keys(object ?? {}).filter(key => !allowed.has(key))
    if (unknown.length) {
      fail(where, `unknown ${label} keys: ${unknown.join(', ')}`)
    }
  }
  // Links written inside text fields obey the same rule as url fields.
  const checkText = (where, text) => {
    for (const [, , href] of (text ?? '').matchAll(MARKDOWN_LINK)) {
      if (!isHttps(href)) {
        fail(where, `link ${href} must be https (write ( and ) as %28 %29)`)
      }
    }
  }
  return { errors, fail, checkText, checkKeys }
}

const validateRecord = ({ classes, issues, updated, doi }) => {
  const { errors, fail, checkText, checkKeys } = problemList()
  if (!isDay(updated)) {
    fail('record', 'updated must be YYYY-MM-DD')
  }
  if (doi !== undefined && !DOI.test(doi)) {
    fail('record', 'doi must be a bare DOI, like 10.5281/zenodo.123')
  }

  const classesById = new Map()
  for (const issueClass of classes) {
    if (!ID.test(issueClass.id)) {
      fail(issueClass.id, 'class id must be lowercase-hyphenated')
    }
    if (classesById.has(issueClass.id)) {
      fail(issueClass.id, 'duplicate class id')
    }
    classesById.set(issueClass.id, issueClass)
    checkKeys(issueClass.id, issueClass, CLASS_KEYS, 'class')
    checkKeys(issueClass.id, issueClass.mappings, MAPPING_LISTS, 'mappings')
    for (const key of ['name', 'attribution', 'description']) {
      if (!issueClass[key]) {
        fail(issueClass.id, `class needs ${key}`)
      }
    }
    for (const key of ['attribution', 'quote', 'description']) {
      checkText(issueClass.id, issueClass[key])
    }
    // Standards mappings: an empty list renders as "no direct mapping".
    for (const list of ['owasp', 'atlas']) {
      for (const mapping of issueClass.mappings?.[list] ?? []) {
        checkKeys(issueClass.id, mapping, MAPPING_KEYS, `mappings.${list}`)
        if (!mapping.id || !mapping.name || !isHttps(mapping.url)) {
          fail(
            issueClass.id,
            `mappings.${list} entries need id, name and https url`,
          )
        }
      }
    }
  }

  const ids = new Set()
  const featured = new Map()
  const fixTally = new Map()
  for (const issue of issues) {
    const where = issue.id ?? issue.title
    const unknown = Object.keys(issue).filter(key => !ISSUE_KEYS.has(key))
    if (unknown.length) {
      fail(where, `unknown keys: ${unknown.join(', ')}`)
    }
    if (!ID.test(issue.id ?? '')) {
      fail(where, 'id must be lowercase-hyphenated')
    }
    if (ids.has(issue.id)) {
      fail(where, 'duplicate id')
    }
    ids.add(issue.id)
    if (classesById.has(issue.id)) {
      fail(where, 'id clashes with a class id')
    }
    const home = classesById.get(issue.class)
    if (!home) {
      fail(where, `unknown class ${issue.class}`)
    }
    if (!issue.title) {
      fail(where, 'needs a title')
    }
    if (issue.url !== null && !isHttps(issue.url)) {
      fail(where, 'url must be https (or null when there is no public source)')
    }
    if (!isRealDate(issue.date)) {
      fail(where, 'date must be a real, past YYYY, YYYY-MM or YYYY-MM-DD')
    }
    if (!issue.harnesses?.length) {
      fail(where, 'needs at least one harness')
    }
    if ('featured' in issue && issue.featured !== true) {
      fail(where, 'featured must be true')
    }
    if (issue.featured) {
      featured.set(issue.class, (featured.get(issue.class) ?? 0) + 1)
    }
    if (!issue.fail) {
      fail(where, 'needs the fail text')
    }
    if (!issue.credit) {
      fail(where, 'needs a credit')
    }
    // The credit text shows the CVE ids; cves[] carries them for machines.
    // Both must name the same set.
    const shown = [...new Set(issue.credit?.match(CVE))].sort().join()
    const listed = [...(issue.cves ?? [])].sort().join()
    if (shown !== listed) {
      fail(where, `cves [${listed}] differ from credit [${shown}]`)
    }
    if (issue.fix) {
      checkKeys(where, issue.fix, FIX_KEYS, 'fix')
    }
    if (issue.fix && !FIX_STATUSES.has(issue.fix.status)) {
      fail(where, `fix.status must be one of ${[...FIX_STATUSES].join(', ')}`)
    }
    if (
      issue.fix &&
      !issue.fix.text &&
      !FIX_WITHOUT_TEXT.has(issue.fix.status)
    ) {
      fail(where, `fix.text is required when the status is ${issue.fix.status}`)
    }
    for (const text of [issue.credit, issue.fail, issue.fix?.text]) {
      checkText(where, text)
    }
    const [withFix, total] = fixTally.get(issue.class) ?? [0, 0]
    fixTally.set(issue.class, [withFix + (issue.fix ? 1 : 0), total + 1])
  }

  // A class shows a Fix column when its issues carry fix, so it is all of
  // them or none: a gap would render as an unexplained dash.
  for (const [id, [withFix, total]] of fixTally) {
    if (withFix && withFix < total) {
      fail(id, `${withFix} of ${total} issues have fix; all or none`)
    }
  }

  for (const [id, count] of featured) {
    if (count > VISIBLE) {
      fail(id, `${count} featured issues; at most ${VISIBLE}`)
    }
  }
  return errors
}

const validateMatrix = ({ updated, groups, harnesses, findings, history }) => {
  const { errors, fail, checkText } = problemList()
  if (!isDay(updated)) {
    fail('matrix', 'updated must be YYYY-MM-DD')
  }
  if (!findings) {
    fail('matrix', 'needs findings')
  }
  checkText('findings', findings)
  if (!Array.isArray(history)) {
    fail('matrix', 'history must be a list (empty when there is none)')
  }

  for (const group of groups) {
    if (!GROUP_ID.test(group.id ?? '') || !group.name || !group.question) {
      fail(
        group.id ?? group.name,
        'group needs a one-letter id, name and question',
      )
    }
  }
  const requirements = groups.flatMap(group => group.requirements)
  const requirementIds = new Set(
    requirements.map(requirement => requirement.id),
  )
  if (requirementIds.size !== requirements.length) {
    fail('matrix', 'duplicate requirement id')
  }
  const markKeys = Object.keys(MARKS).join(', ')
  for (const requirement of requirements) {
    const { id, name, description, spec } = requirement
    if (!REQUIREMENT_ID.test(id ?? '')) {
      fail(id, 'requirement id must be a letter and a number, like A1')
    }
    if (!name || !description) {
      fail(id, 'needs name and description')
    }
    checkText(id, description)
    if (
      !spec?.length ||
      !spec.every(specLink => specLink.label && isHttps(specLink.url))
    ) {
      fail(id, 'needs spec links, each with a label and an https url')
    }
  }
  const harnessIds = new Set()
  for (const harness of harnesses) {
    if (!ID.test(harness.id ?? '')) {
      fail(harness.name, 'id must be lowercase-hyphenated')
    }
    if (harnessIds.has(harness.id)) {
      fail(harness.id, 'duplicate harness id')
    }
    harnessIds.add(harness.id)
    if (!harness.name) {
      fail(harness.id, 'needs a name')
    }
    if (!harness.note) {
      fail(harness.id, 'needs a note')
    }
    checkText(harness.id, harness.note)
    for (const id of requirementIds) {
      if (!Object.hasOwn(MARKS, harness.marks?.[id] ?? '')) {
        fail(harness.id, `${id} mark must be one of ${markKeys}`)
      }
    }
    const extra = Object.keys(harness.marks ?? {}).filter(
      key => !requirementIds.has(key),
    )
    if (extra.length) {
      fail(harness.id, `unknown requirements: ${extra.join(', ')}`)
    }
  }
  for (const entry of Array.isArray(history) ? history : []) {
    if (!isDay(entry.date) || !entry.text) {
      fail('history', 'entries need a YYYY-MM-DD date and text')
    }
    checkText('history', entry.text)
  }
  return errors
}

const validateShifts = list => {
  const { errors, fail, checkText } = problemList()
  if (!Array.isArray(list)) {
    fail('shifts', 'must be a list')
    return errors
  }
  for (const shift of list) {
    const where = shift.title ?? shift.date
    if (
      !isDay(shift.date) ||
      !shift.title ||
      !isHttps(shift.url) ||
      !shift.text
    ) {
      fail(where, 'needs a YYYY-MM-DD date, title, https url and text')
    }
    checkText(where, shift.text)
  }
  return errors
}

// Every id the page renders: the static ones in src/index.html, one per
// class and its folded rows, and one per harness note. A clash would send
// an anchor to the wrong place.
const validatePageIds = () => {
  const { errors, fail } = problemList()
  const html = readFileSync('src/index.html', 'utf8')
  const ids = [
    ...[...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id),
    ...record.classes.flatMap(issueClass => [
      issueClass.id,
      `${issueClass.id}-earlier`,
    ]),
    ...matrix.harnesses.map(harness => harness.id),
  ]
  const seen = new Set()
  for (const id of ids) {
    if (seen.has(id)) {
      fail(id, 'rendered twice as an HTML id')
    }
    seen.add(id)
  }
  return errors
}

// ---- run the checks ---------------------------------------------------------
// Before any rendering, so a bad value is reported, not hit as a crash.
const problems = [
  ['data/record.json', validateRecord(record)],
  ['data/matrix.json', validateMatrix(matrix)],
  ['data/shifts.json', validateShifts(shifts)],
  ['page ids', validatePageIds()],
].filter(([, errors]) => errors.length)

for (const [file, errors] of problems) {
  console.error(
    `${file}: ${errors.length} problem(s)\n  ${errors.join('\n  ')}`,
  )
}
if (problems.length) {
  process.exit(1)
}

if (process.argv.includes('--check')) {
  console.log(
    `data ok: ${record.issues.length} issues, ` +
      `${matrix.harnesses.length} harnesses, ${shifts.length} shifts`,
  )
  process.exit(0)
}

// ---- rendering --------------------------------------------------------------
// Text fields use a small Markdown subset: `code`, **strong**, *emphasis*,
// [text](url), and {?} for the matrix's "undocumented" mark.
// Quotes too: escaped text may land inside an attribute.
const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
const escape = text => text.replace(/[&<>"]/g, character => ENTITIES[character])

const NEW_TAB =
  'target="_blank" rel="noopener noreferrer" aria-describedby="newtab"'
// href is raw; text is HTML already.
const link = (href, text) => `<a href="${escape(href)}" ${NEW_TAB}>${text}</a>`

// Plain text: emphasis and the {?} mark. Only ever applied to the text
// between code spans and links, so a `*` in a glob or a URL never pairs up
// with one outside it.
const plain = text =>
  escape(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replaceAll('{?}', '<span class="s u">?</span>')

// Code spans and links are cut out first, whichever starts earlier: a link
// inside backticks stays literal, and a link's text may hold code. A link
// that fails validation's URL rule renders as its plain text.
const TOKEN = /(`[^`]+`|\[[^\]]+\]\([^)\s]*\))/
const inline = text =>
  text
    .split(TOKEN)
    .map((part, index) => {
      if (index % 2 === 0) {
        return plain(part)
      }
      if (part.startsWith('`')) {
        return `<code>${escape(part.slice(1, -1))}</code>`
      }
      const [, label, href] = part.match(/^\[([^\]]+)\]\(([^)\s]*)\)$/)
      return isHttps(href) ? link(href, inline(label)) : plain(part)
    })
    .join('')

// Dates are calendar dates, so they are formatted in UTC: no time zone can
// move them a day.
const monthYear = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})
const fullDate = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'long',
  timeZone: 'UTC',
})

// The table shows the year; a month is shown only when the year alone would
// hide it in the source (a date recorded to the month, not the day).
const showDate = date => {
  const [year, month, day] = date.split('-')
  return month && !day ? monthYear.format(new Date(date)) : year
}
const longDate = date => fullDate.format(new Date(date))

const plural = (count, one, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`

// The meta line under a section heading: its date, then its counts.
const metaLine = (updated, ...parts) =>
  `<p class="meta">${[`Updated ${longDate(updated)}`, ...parts].join(' · ')}</p>`

// A heading that links to its own anchor, so any section can be shared
// from where it is read (styled as a plain heading; see a.self in CSS).
const heading = (tag, id, html) =>
  `<${tag} id="${id}"><a class="self" href="#${id}">${html}</a></${tag}>`

// Dates of mixed precision compare as text: "2025" sorts before every
// 2025-MM-DD, as the oldest of its year.
const newestFirst = (a, b) => b.date.localeCompare(a.date)

// ---- the record -------------------------------------------------------------
// Issues by class, each in source order. Built once for all classes.
const ownByClass = Map.groupBy(record.issues, issue => issue.class)

// A class's table columns; each cell carries its column name for the
// phone layout, where rows stack as labelled cards.
const columns = fixColumn =>
  fixColumn
    ? ['Issue', 'Date', 'Harness', 'The fail', 'Fix']
    : ['Issue', 'Date', 'Harness', 'The fail']

const tableRow = (fixColumn, values) =>
  `<tr>${columns(fixColumn)
    .map((label, index) => `<td data-label="${label}">${values[index]}</td>`)
    .join('')}</tr>`

const row = (issue, fixColumn) =>
  tableRow(fixColumn, [
    (issue.url ? link(issue.url, escape(issue.title)) : escape(issue.title)) +
      (issue.credit ? ` (${inline(issue.credit)})` : ''),
    showDate(issue.date),
    escape(issue.harnesses.join(', ')),
    inline(issue.fail),
    issue.fix?.text ? inline(issue.fix.text) : '—',
  ])

// Where the class sits in OWASP and MITRE ATLAS, names spelled out. A class
// the standards don't cover says so rather than borrowing a loose fit.
const mappings = ({ owasp = [], atlas = [] }) => {
  if (!owasp.length && !atlas.length) {
    return '<p class="mappings">No direct mapping in OWASP or MITRE ATLAS.</p>'
  }
  const part = (label, items) =>
    `${label}: ${
      items.length
        ? items
            .map(
              mapping =>
                `${link(mapping.url, escape(mapping.name))} (${mapping.id})`,
            )
            .join(', ')
        : 'no direct mapping'
    }`
  return `<p class="mappings">${part('OWASP', owasp)} · ${part('MITRE ATLAS', atlas)}</p>`
}

// The issues table: the class's issues, newest first. At most VISIBLE
// show: the featured ones, topped up with the newest when fewer are
// featured. The rest go in a second tbody that site.js folds behind a
// "Show N more" button. Without JS every row shows.
const issuesTable = issueClass => {
  const own = (ownByClass.get(issueClass.id) ?? []).toSorted(newestFirst)
  if (!own.length) {
    return []
  }

  const shown = new Set(own.filter(issue => issue.featured))
  for (const issue of own) {
    if (shown.size < VISIBLE) {
      shown.add(issue)
    }
  }
  const visible = own.filter(issue => shown.has(issue))
  const earlier = own.filter(issue => !shown.has(issue))
  // The Fix column follows the data: shown when the class's issues carry
  // fix (validation keeps that all or none).
  const fixColumn = own.some(issue => issue.fix)
  const toRow = issue => row(issue, fixColumn)
  const earlierId = `${issueClass.id}-earlier`
  const head = columns(fixColumn)
    .map(label => `<th scope="col">${label}</th>`)
    .join('')

  return [
    '<details class="issues" open>',
    `<summary>${plural(own.length, 'issue')}</summary>`,
    `<div class="tablewrap wide"><table class="record${fixColumn ? '' : ' cols4'}">`,
    `<thead><tr>${head}</tr></thead>`,
    '<tbody>',
    ...visible.map(toRow),
    '</tbody>',
    ...(earlier.length
      ? [
          `<tbody class="earlier" id="${earlierId}">`,
          ...earlier.map(toRow),
          '</tbody>',
          '</table></div>',
          // Labelled by site.js, which is also what shows it.
          `<button type="button" class="more" aria-controls="${earlierId}" aria-expanded="true" hidden></button>`,
        ]
      : ['</table></div>']),
    '</details>',
  ]
}

const recordClass = issueClass =>
  [
    '<section class="rclass">',
    heading('h3', issueClass.id, escape(issueClass.name)),
    `<p class="classname">${inline(issueClass.attribution)}</p>`,
    issueClass.quote &&
      `<blockquote><p>“${inline(issueClass.quote)}”</p></blockquote>`,
    `<p>${inline(issueClass.description)}</p>`,
    issueClass.mappings && mappings(issueClass.mappings),
    ...issuesTable(issueClass),
    '</section>',
  ]
    .filter(Boolean)
    .join('\n')

const recordMeta = metaLine(
  record.updated,
  plural(record.issues.length, 'issue'),
  plural(record.classes.length, 'class', 'classes'),
  link('record.json', 'JSON'),
  ...(record.doi
    ? [link(`https://doi.org/${record.doi}`, `DOI ${record.doi}`)]
    : []),
)

const recordToc = record.classes
  .map(
    issueClass =>
      `<li><a href="#${issueClass.id}">${escape(issueClass.name)}</a></li>`,
  )
  .join('\n')

// ---- the matrix -------------------------------------------------------------
const matrixMeta = metaLine(
  matrix.updated,
  plural(matrix.harnesses.length, 'harness', 'harnesses'),
  plural(
    matrix.groups.flatMap(group => group.requirements).length,
    'requirement',
  ),
  link('matrix.json', 'JSON'),
)

// Built once per mark kind, then reused for every cell.
const markHtml = Object.fromEntries(
  Object.entries(MARKS).map(([key, [glyph, label]]) => [
    key,
    `<span class="s ${key}" title="${label}"><span aria-hidden="true">${glyph}</span>` +
      `<span class="vh">${label}</span></span>`,
  ]),
)

const matrixGroup = group => {
  const requirementItems = group.requirements.map(
    requirement =>
      `  <dt><span class="rid">${requirement.id}</span> ${escape(requirement.name)}</dt>` +
      `<dd>${inline(requirement.description)} <span class="anchor">` +
      `${requirement.spec.map(specLink => link(specLink.url, escape(specLink.label))).join(', ')}</span></dd>`,
  )
  const head = group.requirements.map(
    // A column header may use a shorter name than the requirement list.
    requirement =>
      `<th scope="col">${requirement.id} ${escape(requirement.short ?? requirement.name)}</th>`,
  )
  const rows = matrix.harnesses.map(
    harness =>
      `<tr><th scope="row"><a href="#${harness.id}">${escape(harness.name)}</a></th>` +
      `${group.requirements.map(requirement => `<td>${markHtml[harness.marks[requirement.id]]}</td>`).join('')}</tr>`,
  )
  return [
    `<h4>${group.id}. ${escape(group.name)} — ${escape(group.question)}</h4>`,
    '<dl class="reqs">',
    ...requirementItems,
    '</dl>',
    '',
    // Focusable and named, so keyboard users can scroll a table wider than
    // the screen (Safari does not make scroll areas focusable itself).
    `<figure class="tablewrap wide matrix" tabindex="0" role="region" aria-labelledby="matrix-${group.id}-caption">`,
    `<table class="cols${group.requirements.length}">`,
    `<caption id="matrix-${group.id}-caption">${group.id}. ${escape(group.name)}</caption>`,
    `<thead><tr><th scope="col">Harness</th>${head.join('')}</tr></thead>`,
    '<tbody>',
    ...rows,
    '</tbody>',
    '</table>',
    '</figure>',
  ].join('\n')
}

const matrixNotes = matrix.harnesses
  .map(
    harness =>
      `${heading('h4', harness.id, escape(harness.name))}\n<p>${inline(harness.note)}</p>`,
  )
  .join('\n\n')

const matrixHistory = matrix.history
  .map(entry => {
    const label = entry.label ? ` (${escape(entry.label)})` : ''
    return `<p><strong>${longDate(entry.date)}${label}</strong> — ${inline(entry.text)}</p>`
  })
  .join('\n\n')

// ---- landscape shifts -------------------------------------------------------
const shiftItems = shifts
  .toSorted(newestFirst)
  .map(
    shift =>
      `<li><strong>${longDate(shift.date)}</strong> · ${link(shift.url, escape(shift.title))} · ${inline(shift.text)}</li>`,
  )
  .join('\n')

// ---- document date ----------------------------------------------------------
// The footer dates the document's structure (src/), not its content: the
// record and the matrix carry their own dates. It is today when src/ is part
// of the commit being made (the pre-commit hook builds then), otherwise the
// date of the last commit that touched src/.
const git = (...gitArguments) => {
  try {
    // stderr ignored: outside a git checkout (an archive) git complains,
    // and the fallback below covers it.
    return execFileSync('git', gitArguments, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

const structureUpdated = () => {
  const today = new Date().toLocaleDateString('sv-SE')
  const sourceStaged =
    git('diff', '--cached', '--name-only', '--', 'src') !== ''
  return (
    (!sourceStaged && git('log', '-1', '--format=%cs', '--', 'src')) || today
  )
}

// ---- page -------------------------------------------------------------------
// Each <!-- build:name --> placeholder in src/index.html takes one block.
const fill = (html, [name, content]) => {
  const marker = `<!-- build:${name} -->`
  if (!html.includes(marker)) {
    throw new Error(`src/index.html: missing ${marker}`)
  }
  return html.replace(marker, () => content)
}

const renderPage = () =>
  Object.entries({
    'record-toc': recordToc,
    'record-meta': recordMeta,
    'record': record.classes.map(recordClass).join('\n'),
    'matrix-meta': matrixMeta,
    'matrix-tables': matrix.groups.map(matrixGroup).join('\n\n'),
    'matrix-findings': `<p>${inline(matrix.findings)}</p>`,
    'matrix-notes': matrixNotes,
    'matrix-history': matrixHistory,
    'shifts': shiftItems,
    'updated': longDate(structureUpdated()),
  }).reduce(fill, readFileSync('src/index.html', 'utf8'))

// ---- write ------------------------------------------------------------------
const page = renderPage()

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })
// Everything in src/ except what is rendered or minified here: CNAME and
// .nojekyll go through as they are.
const MINIFIED = /\.(css|js)$/
cpSync('src', OUT, {
  recursive: true,
  filter: path => !MINIFIED.test(path) && !path.endsWith('index.html'),
})
writeFileSync(`${OUT}/index.html`, page)
// The data files are published as they are, byte for byte, so the served
// record.json is the same file as the one in data/ (and on Zenodo).
cpSync('data/record.json', `${OUT}/record.json`)
cpSync('data/matrix.json', `${OUT}/matrix.json`)

// Every stylesheet and script in src/assets/, so a new one cannot be
// dropped by the copy above and missed here.
await build({
  entryPoints: readdirSync('src/assets')
    .filter(name => MINIFIED.test(name))
    .map(name => `src/assets/${name}`),
  outbase: 'src',
  outdir: OUT,
  minify: true,
  target: ['es2020'],
  logLevel: 'warning',
})

console.log(
  `built ${OUT}/: ${record.issues.length} issues in ${record.classes.length} classes`,
)
