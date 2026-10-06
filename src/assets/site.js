// harness.fail — progressive enhancement only. The page reads completely
// without this file; it adds the theme toggle, collapses the Record's
// issues on phones, folds the rest of each class's issues behind a
// button, builds the phone-sized matrix cards, and greets the console.

const root = document.documentElement

const setupTheme = () => {
  const button = document.querySelector('.theme-toggle')
  if (!button) {
    return
  }
  const systemDark = window.matchMedia('(prefers-color-scheme: dark)')

  const current = () =>
    root.getAttribute('data-theme') ?? (systemDark.matches ? 'dark' : 'light')
  const opposite = () => (current() === 'dark' ? 'light' : 'dark')
  const label = () =>
    button.setAttribute('aria-label', `Switch to ${opposite()} theme`)

  button.hidden = false
  label()
  button.addEventListener('click', () => {
    const next = opposite()
    root.setAttribute('data-theme', next)
    try {
      localStorage.setItem('theme', next)
    } catch {
      // storage blocked: the choice lasts for this page view only
    }
    label()
  })
  systemDark.addEventListener('change', label)
}

// ---- Record issues -------------------------------------------------------
// Each class's issues sit in a <details> that is open in the markup, so
// they read fully without JS. On phones they start collapsed behind their
// count; from 720px up they are always open (the summary is hidden by CSS).
// What the reader opens on a phone is remembered, so turning the phone to
// landscape and back does not close it again.
const setupIssues = () => {
  const wide = window.matchMedia('(min-width: 720px)')
  const issues = document.querySelectorAll('details.issues')
  const openedNarrow = new Set()
  for (const details of issues) {
    details.addEventListener('toggle', () => {
      if (wide.matches) {
        return
      }
      if (details.open) {
        openedNarrow.add(details)
      } else {
        openedNarrow.delete(details)
      }
    })
  }
  const fit = () => {
    for (const details of issues) {
      details.open = wide.matches || openedNarrow.has(details)
    }
  }
  fit()
  wide.addEventListener('change', fit)
}

// ---- more issues ---------------------------------------------------------
// A class shows its featured issues, topped up with the newest; the rest
// sit in a second tbody that starts folded here, behind a button that the
// markup ships hidden and unlabelled.
const setupEarlier = () => {
  for (const button of document.querySelectorAll('button.more')) {
    const body = document.getElementById(button.getAttribute('aria-controls'))
    if (!body) {
      continue
    }
    const count = body.rows.length
    const set = open => {
      body.hidden = !open
      button.setAttribute('aria-expanded', String(open))
      button.textContent = open ? 'Show fewer' : `Show ${count} more`
    }
    set(false)
    button.hidden = false
    // Folding removes rows above the button, which would yank the page up
    // past the reader's place. Scroll by the distance the button moved, so
    // it stays under the pointer.
    button.addEventListener('click', () => {
      const before = button.getBoundingClientRect().top
      set(button.getAttribute('aria-expanded') !== 'true')
      // Instant, not the page's smooth scrolling: the button must not move.
      window.scrollBy({
        top: button.getBoundingClientRect().top - before,
        behavior: 'instant',
      })
    })
  }
}

// ---- matrix cards -----------------------------------------------------------
// Each group table lists harnesses as rows. On phones a harness is easier
// to read as one card holding every mark, grouped as the tables are.
// Built from the tables themselves, so the tables stay the only source.
const element = (tag, properties = {}) =>
  Object.assign(document.createElement(tag), properties)

const setupCards = () => {
  const section = document.getElementById('matrix-section')
  const figures = section?.querySelectorAll('figure.tablewrap.matrix') ?? []
  if (!figures.length) {
    return
  }

  const byName = new Map()
  for (const figure of figures) {
    const table = figure.querySelector('table')
    const group = table.caption?.textContent ?? ''
    const headings = [...table.querySelectorAll('thead th')].map(
      heading => heading.textContent,
    )
    for (const tableRow of table.querySelectorAll('tbody tr')) {
      const rowHeading = tableRow.querySelector('th')
      const name = rowHeading.textContent
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          href: rowHeading.querySelector('a')?.getAttribute('href'),
          groups: [],
        })
      }
      const marks = [...tableRow.querySelectorAll('td')].map((cell, i) => ({
        requirement: headings[i + 1],
        cell,
      }))
      byName.get(name).groups.push({ title: group, marks })
    }
  }

  const wrap = element('ul', { className: 'cards' })
  wrap.setAttribute('aria-label', 'Scores by harness')

  for (const harness of byName.values()) {
    const card = element('li', { className: 'hcard' })
    const title = element('h4')
    title.append(
      harness.href
        ? element('a', { href: harness.href, textContent: harness.name })
        : harness.name,
    )
    card.append(title)

    for (const group of harness.groups) {
      card.append(element('p', { className: 'grp', textContent: group.title }))
      const markList = element('dl')
      for (const mark of group.marks) {
        const markValue = element('dd')
        for (const node of mark.cell.childNodes) {
          markValue.append(node.cloneNode(true))
        }
        markList.append(
          element('dt', { textContent: mark.requirement }),
          markValue,
        )
      }
      card.append(markList)
    }
    wrap.append(card)
  }

  // Desktop shows each table under its own requirement group; on phones
  // the tables are hidden and the cards appear together under "Scores by
  // harness".
  const slot = section.querySelector('.cards-slot')
  if (slot) {
    slot.append(wrap)
  } else {
    figures[0].before(wrap)
  }
  section.classList.add('has-cards')
}

// ---- for those who open DevTools --------------------------------------------
const greet = () => {
  const title = 'font: 700 20px ui-monospace, Menlo, monospace'
  const body = 'font: 12px ui-monospace, Menlo, monospace; line-height: 1.6'
  console.log(
    `%cHere There Be Fails
%c
Past this point the map ends and the harnesses no longer hold.

Charted a fail I missed? Bring a source:
https://github.com/harnessfail/harness.fail`,
    title,
    body,
  )
}

setupTheme()
setupIssues()
setupEarlier()
setupCards()
greet()
