"""Turn inert controls of the teacher canvas into <a href> links for Play mode.

Usage: python3 -I linkify.py <project dir>
Edits component files in place. Prints every op and fails loudly on a miss.
"""
import re, sys, os

P = sys.argv[1]

# Chrome shared by every screen. Targets are keys of `go` (built in JS, dark-aware).
CHROME_BTN = [
    ("all", "button", "@Ajustes", "go.settings"),
    ("all", "button", "@Inicio", "go.home"),
    ("all", "button", "@Biblioteca", "go.lib"),
    ("all", "button", "@{{libLabel}}", "go.lib"),
    ("all", "button", "@Exámenes", "go.exams"),
    ("all", "button", "@Plan del año", "go.plan"),
    ("all", "button", "Asistente", "go.chat"),
]
CHROME_SPAN = [
    ("all", "span", "@Ajustes", "go.settings"),
    ("all", "span", "@Inicio", "go.home"),
    ("all", "span", "@Biblioteca", "go.lib"),
    ("all", "span", "@Exámenes", "go.exams"),
    ("all", "span", "@Plan del año", "go.plan"),
    ("all", "span", "Asistente⌘J", "go.chat"),
]
RAIL_FOR = "o.rail = (o.rail || []).map((n) => ({ ...n, href: ({'Inicio': g.home, 'Biblioteca': g.lib, 'Exámenes': g.exams, 'Plan del año': g.plan, 'Asistente': g.chat})[n.label] || '#' }));"

OPS = {
    "OptB": CHROME_BTN + [
        ("at", 47, "a", "Materias que ya no das", "go.past"),
        ("at", 51, "button", "Nueva materia", "go.subjectNew"),
        ("at", 52, "button", "Crear una clase", "go.classNew"),
        ("at", 73, "a", "Prefiero empezar", "go.lib"),
        ("at", 75, "button", "Crear una materia", "go.subjectNew"),
        ("at", 76, "button", "Crear mi primera clase", "go.classNew"),
        ("at", 98, "button", "Abrir", "r.href"),
        ("at", 147, "button", "Abrir", "r.href"),
        ("at", 112, "div", "", "go.subject"),
    ],
    "Subject": CHROME_BTN + [
        ("at", 50, "button", "Nueva unidad", "go.unitNew"),
        ("at", 51, "button", "Crear una clase", "go.classNew"),
        ("at", 59, "span", "", "y.href"),
        ("at", 69, "button", "Volver a 2026", "go.subject"),
        ("at", 92, "div", "", "go.classEdit"),
        ("at", 117, "button", "Nuevo examen", "go.examNew"),
        ("at", 122, "div", "", "go.examReview"),
    ],
    "Library": CHROME_BTN + [
        ("at", 45, "button", "Agregar fuente", "go.addMenu"),
        ("at", 50, "div", "", "o.href"),
        ("at", 82, "div", "", "go.source"),
    ],
    "Source": CHROME_BTN + [
        ("at", 49, "button", "Editar datos", "go.sourceEdit"),
    ],
    "SourceSheet": [
        ("at", 28, "button", "@Cerrar", "go.sheetBack"),
        ("at", 78, "button", "Cancelar", "go.sheetBack"),
        ("at", 79, "button", "{{saveLabel}}", "go.sheetSave"),
    ],
    "Settings": CHROME_BTN + [
        ("at", 51, "button", "Agregar colegio", "go.school"),
        ("at", 66, "button", "Editar", "go.school"),
    ],
    "Plan": CHROME_BTN + [
        ("at", 65, "button", "Cambiar el pedido", "go.planAsk"),
        ("at", 77, "button", "Crear las 32 clases", "go.subject"),
    ],
    "ClassNew": CHROME_BTN + [
        ("at", 113, "button", "Buscar más", "go.sourcesChat"),
        ("at", 121, "button", "Guardar como pendiente", "go.subject"),
        ("at", 122, "button", "Armar la clase", "go.workA"),
    ],
    "ClassEdit": CHROME_BTN + [
        ("at", 44, "span", "80 min", "go.date"),
        ("at", 46, "button", "Exportar", "go.export"),
        ("at", 47, "button", "Aprobar", "go.subject"),
        ("at", 52, "span", "", "tb.href"),
        ("at", 59, "div", "", "go.slide"),
        ("at", 112, "span", "{{m.link}}", "go.proposed"),
    ],
    "Export": [
        ("at", 72, "span", "Cambiar en Ajustes", "go.settings"),
        ("at", 98, "button", "Cancelar", "go.classEdit"),
        ("at", 99, "button", "Exportar 3 PDF", "go.exportDone"),
    ],
    "ExportFlow": [
        ("at", 41, "button", "Cancelar", "go.classEdit"),
        ("at", 71, "button", "Listo", "go.classEdit"),
        ("at", 112, "span", "Cambiar en Ajustes", "go.settings"),
        ("at", 117, "button", "Cancelar", "go.examReview"),
        ("at", 118, "button", "Exportar 3 PDF", "go.examReview"),
    ],
    "ExamNew": CHROME_BTN + [
        ("at", 51, "div", "", "o.href"),
        ("at", 159, "button", "Generar examen", "go.workExam"),
    ],
    "ExamReview": CHROME_BTN + [
        ("at", 51, "button", "Exportar", "go.exportExam"),
        ("at", 52, "button", "Aprobar", "go.exams"),
        ("at", 74, "button", "Editar", "go.qedit"),
    ],
    "Chat": CHROME_BTN + [
        ("at", 36, "button", "@{{n.label}}", "n.href"),
        ("at", 40, "button", "@Asistente", "go.chat"),
        ("at", 50, "button", "Nueva unidad", "go.unitNew"),
        ("at", 51, "button", "Crear una clase", "go.classNew"),
        ("at", 63, "div", "", "go.classEdit"),
        ("at", 87, "a", "Volver a", "go.subject"),
        ("at", 91, "button", "@Cerrar", "go.chatClosed"),
        ("at", 108, "button", "Abrir", "go.examReview"),
        ("at", 117, "button", "Ir a Ajustes", "go.settings"),
    ],
    "ChatForm": CHROME_BTN + [
        ("at", 33, "button", "@{{n.label}}", "n.href"),
        ("at", 57, "button", "Generar examen", "go.workExam"),
        ("at", 65, "button", "@Cerrar", "go.chatClosed"),
    ],
    "Working": CHROME_BTN + [
        ("at", 38, "button", "@{{n.label}}", "n.href"),
        ("at", 156, "button", "Cancelar", "go.workCancel"),
        ("at", 157, "button", "Seguir en segundo plano", "go.workBg"),
        ("at", 171, "button", "Abrir", "go.classEdit"),
    ],
    "SubjectFlow": [
        ("at", 50, "button", "Cancelar", "go.home"),
        ("at", 51, "button", "Crear materia", "go.subjectEmpty"),
        ("at", 66, "span", "Asistente", "go.chat"),
        ("at", 71, "span", "@{{n.label}}", "n.href"),
        ("at", 88, "div", "", "s.href"),
        ("at", 127, "button", "Cancelar", "go.subject"),
        ("at", 128, "button", "Crear unidad", "go.subject"),
    ],
    "GapsClass": CHROME_SPAN + [
        ("all", "span", "Diapositivas · 12", "go.classEdit"),
        ("all", "span", "Guion · 80 min", "go.guion"),
        ("all", "span", "Material para alumnos", "go.material"),
        ("all", "button", "Exportar", "go.export"),
        ("all", "button", "Aprobar", "go.subject"),
        ("at", 18, "span", "✕", "go.classEdit"),
        ("at", 21, "button", "Deshacer", "go.classEdit"),
        ("at", 21, "button", "Listo", "go.classEdit"),
        ("at", 22, "button", "Buscar más", "go.sourcesChat"),
        ("at", 22, "button", "Cancelar", "go.subject"),
        ("at", 22, "button", "Armar la clase", "go.workA"),
        ("at", 23, "button", "Quedarme con lo que hay", "go.classEdit"),
        ("at", 23, "button", "Reintentar lo que falta", "go.workA"),
        ("at", 24, "button", "Reintentar ahora", "go.classEdit"),
        ("at", 25, "button", "Cancelar", "go.classEdit"),
        ("at", 25, "button", "Guardar", "go.classEdit"),
    ],
    "GapsMisc": CHROME_SPAN + [
        ("at", 18, "button", "Cancelar", "go.examReview"),
        ("at", 18, "button", "Guardar pregunta", "go.examReview"),
        ("at", 19, "button", "Nuevo examen", "go.examNew"),
        ("at", 19, "div", "Evaluación · U4 Ecosistemas", "go.examReview"),
        ("at", 20, "button", "Armar el plan", "go.workPlan"),
        ("at", 21, "button", "Cancelar", "go.settings"),
        ("at", 21, "button", "Guardar colegio", "go.settings"),
        ("at", 22, "button", "Cancelar", "go.subject"),
        ("at", 22, "button", "Guardar", "go.subject"),
    ],
    "GapsSource": CHROME_SPAN + [
        ("all", "div", "[menuitem]Subir un archivo", "go.sourceNew"),
        ("all", "div", "[menuitem]Pegar un link", "go.sourceNew"),
        ("all", "div", "[menuitem]Escanear un papel", "go.noOcr"),
        ("all", "div", "[menuitem]Pedírsela al Asistente", "go.sourcesChat"),
        ("at", 19, "button", "Ahora no", "go.lib"),
        ("at", 19, "button", "Instalar y seguir", "go.ocr"),
        ("at", 20, "button", "Descartar", "go.lib"),
        ("at", 20, "button", "Seguir con la ficha", "go.sourceNew"),
        ("at", 21, "button", "Editar datos", "go.sourceEdit"),
        ("at", 22, "button", "Listo", "go.lib"),
        ("at", 23, "span", "✕", "go.lib"),
    ],
    "GapsYear": CHROME_SPAN + [
        ("at", 18, "button", "Cancelar", "go.subject"),
        ("at", 18, "button", "Traer a 2027", "go.drafts"),
        ("all", "button", "Nueva unidad", "go.unitNew"),
        ("all", "button", "Crear una clase", "go.classNew"),
        ("all", "button", "Abrir", "go.subjectPast"),
        ("all", "button", "Volver a darla", "go.yearStart"),
    ],
}

# Extra JS per file, run in the wrapper after `o` and `g` (the go map) exist.
EXTRA = {
    "OptB": "o.review = (o.review || []).map((r) => ({ ...r, href: /^(Examen|Evaluación)/.test(r.title) ? g.examReview : g.classEdit }));",
    "Subject": "o.years = (o.years || []).map((y) => ({ ...y, href: String(y.label).startsWith('2026') ? g.subject : g.subjectPast }));",
    "Library": "o.addOptions = (o.addOptions || []).map((x) => ({ ...x, href: /Escane/.test(x.label) ? g.noOcr : /Asistente|IA que busque/.test(x.label) ? g.sourcesChat : g.sourceNew }));",
    "SourceSheet": "const nw = this.props.variant !== 'edit'; g.sheetBack = nw ? g.lib : g.source; g.sheetSave = nw ? g.uploaded : g.source;",
    "ClassEdit": "o.tabs = (o.tabs || []).map((x) => ({ ...x, href: /^Guion/.test(x.label) ? g.guion : /^Material/.test(x.label) ? g.material : g.classEdit }));",
    "ExamNew": "o.origins = (o.origins || []).map((x) => ({ ...x, href: /material/i.test(x.title) ? g.examNewMaterial : g.examNew }));",
    "Chat": RAIL_FOR,
    "ChatForm": RAIL_FOR,
    "Working": RAIL_FOR + " const v = this.props.variant || 'a'; g.workCancel = v === 'exam' ? g.examNew : v === 'plan' ? g.planAsk : g.classNew; g.workBg = v === 'exam' ? g.examReview : v === 'plan' ? g.plan : b('WorkBg');",
    "SubjectFlow": RAIL_FOR + " o.starts = (o.starts || []).map((x) => ({ ...x, href: /plan/i.test(x.name) ? g.planAsk : /unidad/i.test(x.name) ? g.unitNew : g.classNew }));",
}

GO = {
    "home": "OptB", "lib": "Library", "exams": "GapAllExams", "plan": "Plan", "settings": "Settings",
    "chat": "ChatA", "chatClosed": "ChatClosed", "past": "GapPastSubjects", "subjectNew": "SubjectNew",
    "subjectEmpty": "SubjectEmpty", "unitNew": "UnitNew", "subject": "Subject", "subjectPast": "SubjectPast",
    "classNew": "ClassNew", "classEdit": "ClassEdit", "examNew": "ExamNew", "examNewMaterial": "ExamNewMaterial",
    "examReview": "ExamReview", "addMenu": "GapAddMenu", "source": "Source", "sourceNew": "SourceNew",
    "sourceEdit": "SourceEdit", "uploaded": "GapUploaded", "school": "GapSchool", "planAsk": "GapPlanAsk",
    "sourcesChat": "GapSourcesChat", "workA": "WorkA", "workExam": "WorkExam", "workPlan": "WorkPlan",
    "date": "GapDate", "export": "Export", "exportDone": "ExportDone", "exportExam": "ExportExam",
    "slide": "GapSlide", "proposed": "GapProposed", "guion": "GapGuion", "material": "GapMaterial",
    "qedit": "GapQuestionEdit", "noOcr": "GapNoOcr", "ocr": "GapOcrText", "drafts": "GapYearDrafts",
    "yearStart": "GapYearStart",
}


def strip(html):
    return re.sub(r'\s+', '', re.sub(r'<[^>]+>', '', html))


def close_of(s, tag, start):
    """Index of the matching </tag> for the opening tag at `start`."""
    depth = 0
    for m in re.compile(r'<(/?)' + tag + r'\b[^>]*>').finditer(s, start):
        if m.group(1):
            depth -= 1
            if depth == 0:
                return m.start(), m.end()
        elif not m.group(0).endswith('/>'):
            depth += 1
    raise ValueError('unbalanced ' + tag)


def matches(s, tag, m, want):
    if want == "":
        return True
    attrs = m.group(0)
    if want.startswith('[menuitem]'):
        if 'role="menuitem"' not in attrs:
            return False
        want = want[len('[menuitem]'):]
    if want.startswith('@'):
        al = re.search(r'aria-label="([^"]*)"', attrs)
        return bool(al) and al.group(1) == want[1:]
    c0, _ = close_of(s, tag, m.start())
    return strip(s[m.end():c0]).startswith(re.sub(r'\s+', '', want))


def convert(s, tag, m, href):
    """Replace the element opened by match m with an <a> carrying href."""
    c0, c1 = close_of(s, tag, m.start())
    open_tag = m.group(0)
    attrs = open_tag[len(tag) + 1:-1]
    attrs = re.sub(r'\s*href="[^"]*"', '', attrs)
    sm = re.search(r'style="([^"]*)"', attrs)
    style = sm.group(1).strip() if sm else ''
    add = []
    if tag in ('button', 'div') and 'display:' not in style.replace(' ', ''):
        add.append('display: inline-flex; align-items: center; justify-content: center;' if tag == 'button' else 'display: block;')
    if not re.search(r'(^|;)\s*color:', style):
        add.append('color: inherit;')
    if tag == 'button':
        add.append('box-sizing: border-box;')
    add.append('text-decoration: none; cursor: pointer;')
    style = (style.rstrip(';') + '; ' if style else '') + ' '.join(add)
    if sm:
        attrs = attrs[:sm.start()] + 'style="' + style + '"' + attrs[sm.end():]
    else:
        attrs += ' style="' + style + '"'
    new_open = '<a href="{{' + href + '}}"' + attrs + '>'
    return s[:m.start()] + new_open + s[m.end():c0] + '</a>' + s[c1:]


def line_span(s, line):
    starts = [0] + [i + 1 for i, ch in enumerate(s) if ch == '\n']
    a = starts[line - 1]
    b = s.find('\n', a)
    return a, (len(s) if b < 0 else b)


def apply(name, s, ops):
    # Apply line-anchored ops bottom-up so line numbers stay valid; 'all' ops last.
    at = sorted([o for o in ops if o[0] == 'at'], key=lambda o: -o[1])
    for _, line, tag, want, href in at:
        a, b = line_span(s, line)
        hit = None
        for m in re.compile(r'<' + tag + r'\b[^>]*>').finditer(s, a, b):
            if matches(s, tag, m, want):
                hit = m
                break
        if not hit:
            raise SystemExit(f'MISS {name} l{line} {tag} {want!r}')
        s = convert(s, tag, hit, href)
        print(f'  ok {name} l{line} {tag} {want!r} -> {href}')
    for _, tag, want, href in [o for o in ops if o[0] == 'all']:
        n = 0
        pos = 0
        while True:
            pat = re.compile(r'<' + tag + r'\b[^>]*>')
            m = pat.search(s, pos)
            if not m:
                break
            if matches(s, tag, m, want):
                s = convert(s, tag, m, href)
                n += 1
            pos = m.start() + 1
        print(f'  {"ok" if n else "--"} {name} all {tag} {want!r} -> {href} x{n}')
    return s


def wrap_js(name, s):
    if '__rv()' in s:
        raise SystemExit(f'{name} already linkified')
    s, k = re.subn(r'\n(\s*)renderVals\(\)\s*\{', r'\n\1__rv() {', s, count=1)
    assert k == 1, name
    go = ', '.join(f"{k}: b('{v}')" for k, v in GO.items())
    method = (
        "\n  renderVals() {\n"
        "    const o = this.__rv();\n"
        "    const sx = this.props.dark ? 'Dark' : '';\n"
        "    const b = (n) => n + sx + '.dc.html';\n"
        f"    const g = {{ {go} }};\n"
        f"    {EXTRA.get(name, '')}\n"
        "    o.go = g;\n"
        "    return o;\n"
        "  }\n"
    )
    i = s.rfind('}\n</script>')
    assert i > 0, name
    return s[:i] + method.lstrip('\n') + s[i:]


for name, ops in OPS.items():
    f = os.path.join(P, name + '.dc.html')
    s = open(f).read()
    s = apply(name, s, ops)
    s = wrap_js(name, s)
    open(f, 'w').write(s)
print('done')
