"""
Generate a realistic-looking GIF showing Claude Code interacting with the
Embedded AI Debug extension. Simulates VS Code dark theme with split panes:
left = C source code with a breakpoint, right = terminal with Claude dialogue.
"""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent.parent / "images" / "demo.gif"
OUT.parent.mkdir(parents=True, exist_ok=True)

W, H = 960, 540
FONT_REG = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 13)
FONT_BOLD = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 13)
FONT_SMALL = ImageFont.truetype("C:/Windows/Fonts/consola.ttf", 11)
FONT_TITLE = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 12)

# VS Code dark theme colors
BG        = (30, 30, 30)
PANEL_BG  = (37, 37, 38)
BORDER    = (62, 62, 66)
TEXT      = (212, 212, 212)
MUTED     = (128, 128, 128)
ACCENT    = (0, 122, 204)
LINE_BG   = (45, 45, 45)
BP_RED    = (229, 72, 77)
CURRENT   = (80, 60, 30)
KEYWORD   = (86, 156, 214)
STRING    = (206, 145, 120)
COMMENT   = (106, 153, 85)
FUNC      = (220, 220, 170)
TYPE      = (78, 201, 176)
NUMBER    = (181, 206, 168)
USER      = (87, 166, 74)
CLAUDE    = (156, 220, 254)
TOOL      = (220, 160, 80)
OK_GREEN  = (78, 201, 176)

C_CODE = [
    ("#include", KEYWORD), " ", ('"main.h"', STRING), "\n",
    "\n",
    "#define", " ", "LED1_PIN", " ", "GPIO_PIN_9", "\n",
    "#define", " ", "LED2_PIN", " ", "GPIO_PIN_10", "\n",
    "\n",
    ("void", KEYWORD), " ", ("LED2_ToggleEvery10", FUNC), "(", ("void", KEYWORD), ") {", "\n",
    "    ", ("static", KEYWORD), " ", ("uint32_t", TYPE), " count = ", ("0", NUMBER), ";", "\n",
    "    ", ("if", KEYWORD), " (++count >= ", ("10", NUMBER), ") {", "\n",
    "        count = ", ("0", NUMBER), ";", "\n",
    "        ", ("HAL_GPIO_TogglePin", FUNC), "(GPIOG, LED2_PIN);", "\n",
    "    }", "\n",
    "}", "\n",
    "\n",
    ("// Main loop toggles LED every 10 cycles", COMMENT), "\n",
    ("int", KEYWORD), " ", ("main", FUNC), "(", ("void", KEYWORD), ") {", "\n",
    "    ", ("HAL_Init", FUNC), "();", "\n",
    "    ", ("GPIO_Init", FUNC), "();", "\n",
    "    ", ("while", KEYWORD), " (", ("1", NUMBER), ") {", "\n",
    "        ", ("LED2_ToggleEvery10", FUNC), "();", "\n",
    "        ", ("HAL_Delay", FUNC), "(", ("500", NUMBER), ");", "\n",
    "    }", "\n",
    "}", "\n",
]


def render_code_pane(draw, x0, y0, w, h, highlight_line=None, bp_lines=()):
    draw.rectangle((x0, y0, x0 + w, y0 + h), fill=BG)
    draw.rectangle((x0, y0, x0 + 36, y0 + h), fill=(24, 24, 24))
    draw.text((x0 + 8, y0 + 4), "main.c", font=FONT_TITLE, fill=MUTED)
    draw.line((x0, y0 + 22, x0 + w, y0 + 22), fill=BORDER)

    tokens = []
    current_color = TEXT
    for item in C_CODE:
        if isinstance(item, tuple):
            tokens.append(item)
        else:
            tokens.append((item, TEXT))

    lines = [[]]
    for text, color in tokens:
        parts = text.split("\n")
        for i, part in enumerate(parts):
            if part:
                lines[-1].append((part, color))
            if i < len(parts) - 1:
                lines.append([])

    y = y0 + 28
    for ln, line in enumerate(lines, 1):
        ly = y + (ln - 1) * 17
        if ly > y0 + h - 20:
            break
        if highlight_line == ln:
            draw.rectangle((x0 + 36, ly - 2, x0 + w, ly + 15), fill=CURRENT)
        if ln in bp_lines:
            draw.ellipse((x0 + 20, ly + 3, x0 + 30, ly + 13), fill=BP_RED)
        draw.text((x0 + 6, ly), f"{ln:>3}", font=FONT_SMALL, fill=MUTED)
        x = x0 + 44
        for text, color in line:
            draw.text((x, ly), text, font=FONT_REG, fill=color)
            bbox = draw.textbbox((x, ly), text, font=FONT_REG)
            x = bbox[2]


def render_terminal(draw, x0, y0, w, h, lines):
    draw.rectangle((x0, y0, x0 + w, y0 + h), fill=PANEL_BG)
    draw.rectangle((x0, y0, x0 + w, y0 + 24), fill=(51, 51, 51))
    draw.text((x0 + 10, y0 + 6), "Claude Code — STM32F407", font=FONT_TITLE, fill=TEXT)
    draw.ellipse((x0 + w - 18, y0 + 8, x0 + w - 10, y0 + 16), fill=(226, 126, 52))

    y = y0 + 30
    for text, color in lines:
        draw.text((x0 + 10, y), text, font=FONT_REG, fill=color)
        y += 16
        if y > y0 + h - 20:
            break


def status_bar(draw, text="  STM32F407  |  paused at main.c:74  |  MCP :7580 [connected]"):
    draw.rectangle((0, H - 22, W, H), fill=ACCENT)
    draw.text((8, H - 19), text, font=FONT_SMALL, fill=(255, 255, 255))


# ─── Peripheral Tester UI ──────────────────────────────────────────────────
PT_BG       = (24, 26, 40)
PT_PANEL    = (32, 35, 50)
PT_INPUT    = (14, 16, 28)
PT_BTN      = (70, 88, 135)
PT_BTN_TXT  = (220, 230, 255)
PT_DANGER   = (200, 60, 60)
PT_ACCENT   = (110, 170, 240)
PT_GREEN    = (60, 200, 120)
PT_LABEL    = (170, 180, 210)


def draw_input(draw, x, y, w, h, text, selected=False):
    border = PT_ACCENT if selected else (58, 62, 82)
    draw.rectangle((x, y, x + w, y + h), fill=PT_INPUT, outline=border)
    draw.text((x + 10, y + (h - 14) // 2), text, font=FONT_REG, fill=TEXT)
    # dropdown arrow
    ax = x + w - 14
    ay = y + h // 2
    draw.polygon([(ax, ay - 3), (ax + 7, ay - 3), (ax + 3, ay + 3)], fill=MUTED)


def draw_btn(draw, x, y, w, h, text, color=PT_BTN, active=False):
    fill = color if not active else (90, 140, 220)
    draw.rectangle((x, y, x + w, y + h), fill=fill)
    tw = draw.textlength(text, font=FONT_REG)
    draw.text((x + (w - tw) // 2, y + (h - 14) // 2), text, font=FONT_REG, fill=PT_BTN_TXT)


def draw_tab(draw, x, y, w, h, text, active=False):
    if active:
        draw.rectangle((x, y, x + w, y + h), fill=PT_BTN)
        draw.text((x + 10, y + 6), text, font=FONT_BOLD, fill=PT_BTN_TXT)
    else:
        draw.text((x + 10, y + 6), text, font=FONT_REG, fill=PT_LABEL)


def render_peripheral_tester(draw, gpio_state=None, init_pulse=False, log_lines=None, active_btn=None):
    """Render the Peripheral Tester UI. gpio_state: 'high'|'low'|None"""
    draw.rectangle((0, 0, W, H), fill=PT_BG)
    # Title header
    draw.rectangle((0, 0, W, 38), fill=PT_PANEL)
    draw.text((15, 10), "Peripheral Tester — Live hardware control without firmware",
              font=FONT_BOLD, fill=TEXT)

    # Top chip bar
    top_y = 52
    draw.ellipse((18, top_y + 8, 30, top_y + 20), fill=PT_GREEN)
    draw_input(draw, 40, top_y, 240, 26, "stm32f4")
    draw_btn(draw, 290, top_y, 85, 26, "⟳ Detect")
    draw_btn(draw, 380, top_y, 75, 26, "|| Halt")
    draw_btn(draw, 460, top_y, 95, 26, "▶ Resume")
    draw_btn(draw, 560, top_y, 75, 26, "⟲ Reset")
    draw_btn(draw, 640, top_y, 120, 26, "🗑 Erase Flash", color=PT_DANGER)

    # Tabs
    tab_y = 95
    tabs = ["GPIO", "SPI", "I2C", "USART", "CAN", "RTC", "Register", "PWM"]
    tx = 15
    for t in tabs:
        w = 70 if t != "Register" else 85
        draw_tab(draw, tx, tab_y, w, 28, t, active=(t == "GPIO"))
        tx += w + 4

    # GPIO Init section
    y = 140
    draw.text((18, y), "INITIALIZE PIN", font=FONT_BOLD, fill=PT_LABEL)
    draw.line((18, y + 18, 470, y + 18), fill=(50, 55, 75))
    y += 28
    draw.text((25, y + 5), "Pin", font=FONT_REG, fill=PT_LABEL)
    draw_input(draw, 85, y, 180, 26, "PA5")
    y += 34
    draw.text((25, y + 5), "Mode", font=FONT_REG, fill=PT_LABEL)
    draw_input(draw, 85, y, 180, 26, "Output")
    y += 34
    draw.text((25, y + 5), "Pull", font=FONT_REG, fill=PT_LABEL)
    draw_input(draw, 85, y, 180, 26, "None")
    y += 38
    draw_btn(draw, 85, y, 85, 28, "Init pin", active=(active_btn == "init") or init_pulse)

    # Set output section (right column)
    rx = 490
    ry = 140
    draw.text((rx, ry), "SET OUTPUT", font=FONT_BOLD, fill=PT_LABEL)
    draw.line((rx, ry + 18, W - 20, ry + 18), fill=(50, 55, 75))
    ry += 28
    draw.text((rx + 5, ry + 5), "Pin", font=FONT_REG, fill=PT_LABEL)
    draw_input(draw, rx + 55, ry, 180, 26, "PA5")
    ry += 38
    draw_btn(draw, rx + 55, ry, 85, 28, "Set HIGH",
             color=PT_GREEN if gpio_state == 'high' else PT_BTN,
             active=(active_btn == "high"))
    draw_btn(draw, rx + 150, ry, 85, 28, "Set LOW",
             color=PT_DANGER if gpio_state == 'low' else PT_BTN,
             active=(active_btn == "low"))

    # LED visual indicator for PA5
    ry += 50
    draw.text((rx + 5, ry), "PA5:", font=FONT_BOLD, fill=PT_LABEL)
    led_color = PT_GREEN if gpio_state == 'high' else (80, 30, 30) if gpio_state == 'low' else (60, 60, 60)
    draw.ellipse((rx + 55, ry - 3, rx + 85, ry + 27), fill=led_color,
                 outline=(200, 200, 200) if gpio_state == 'high' else (80, 80, 80))
    if gpio_state == 'high':
        draw.text((rx + 95, ry + 5), "HIGH (3.3V)", font=FONT_REG, fill=PT_GREEN)
    elif gpio_state == 'low':
        draw.text((rx + 95, ry + 5), "LOW (0V)", font=FONT_REG, fill=(200, 100, 100))
    else:
        draw.text((rx + 95, ry + 5), "(uninitialized)", font=FONT_REG, fill=MUTED)

    # Monitor log at bottom
    ly = 380
    draw.rectangle((15, ly, W - 15, ly + 130), fill=(20, 22, 34), outline=(50, 55, 75))
    draw.text((22, ly + 6), "Monitor", font=FONT_BOLD, fill=PT_LABEL)
    draw.line((15, ly + 24, W - 15, ly + 24), fill=(50, 55, 75))
    if log_lines:
        py = ly + 30
        for text, color in log_lines:
            draw.text((22, py), text, font=FONT_REG, fill=color)
            py += 16


def make_pt_frame(gpio_state=None, init_pulse=False, log_lines=None, active_btn=None,
                  status="  STM32F407  |  OpenOCD :50002  |  Peripheral Tester [live]"):
    img = Image.new("RGB", (W, H), PT_BG)
    draw = ImageDraw.Draw(img)
    render_peripheral_tester(draw, gpio_state, init_pulse, log_lines, active_btn)
    status_bar(draw, status)
    return img


def make_frame(terminal_lines, code_highlight=None, code_bps=()):
    img = Image.new("RGB", (W, H), BG)
    draw = ImageDraw.Draw(img)
    pane_h = H - 22
    half_w = W // 2
    render_code_pane(draw, 0, 0, half_w, pane_h, code_highlight, code_bps)
    draw.line((half_w, 0, half_w, pane_h), fill=BORDER)
    render_terminal(draw, half_w, 0, W - half_w, pane_h, terminal_lines)
    status_bar(draw)
    return img


script = [
    # Each entry: (list of (text, color) lines, code_highlight_line, bp_lines, frame_count)
    ([("> User: Pause at LED2_ToggleEvery10, read", USER),
      ("         variables, then force the LED toggle", USER)],
     None, (), 20),

    ([("> User: Pause at LED2_ToggleEvery10, read", USER),
      ("         variables, then force the LED toggle", USER),
      ("", TEXT),
      ("Claude:  I'll set a breakpoint at main.c:74,", CLAUDE),
      ("         read variables, then inject count=9.", CLAUDE)],
     None, (), 25),

    ([("> User: Pause at LED2_ToggleEvery10, read", USER),
      ("         variables, then force the LED toggle", USER),
      ("", TEXT),
      ("Claude:  I'll set a breakpoint at main.c:74,", CLAUDE),
      ("         read variables, then inject count=9.", CLAUDE),
      ("", TEXT),
      ("  > set_breakpoint(file='main.c', line=74)", TOOL),
      ("  ✓ breakpoint set at main.c:74", OK_GREEN)],
     None, (74,), 30),

    ([("  > set_breakpoint(file='main.c', line=74)", TOOL),
      ("  ✓ breakpoint set at main.c:74", OK_GREEN),
      ("", TEXT),
      ("  > continue_execution()", TOOL),
      ("  ... running ...", MUTED),
      ("  ★ halted — hit main.c:74", OK_GREEN)],
     74, (74,), 30),

    ([("  > continue_execution()", TOOL),
      ("  ★ halted — hit main.c:74", OK_GREEN),
      ("", TEXT),
      ("  > get_variables()", TOOL),
      ("  ✓ count        = 0", OK_GREEN),
      ("    uwTick       = 4509", TEXT),
      ("    SystemCoreClock = 168000000", TEXT)],
     74, (74,), 35),

    ([("  > get_variables()", TOOL),
      ("  ✓ count        = 0", OK_GREEN),
      ("    uwTick       = 4509", TEXT),
      ("    SystemCoreClock = 168000000", TEXT),
      ("", TEXT),
      ("Claude:  count is 0 → LED won't toggle for", CLAUDE),
      ("         ~5s. Let me force count=9.", CLAUDE)],
     74, (74,), 30),

    ([("  > get_variables()", TOOL),
      ("  ✓ count = 0", OK_GREEN),
      ("", TEXT),
      ("Claude:  count is 0 → LED won't toggle for", CLAUDE),
      ("         ~5s. Let me force count=9.", CLAUDE),
      ("", TEXT),
      ("  > evaluate('count = 9')", TOOL),
      ("  ✓ count = 9", OK_GREEN)],
     74, (74,), 30),

    ([("  > evaluate('count = 9')", TOOL),
      ("  ✓ count = 9", OK_GREEN),
      ("", TEXT),
      ("  > continue_execution()", TOOL),
      ("  ... running ...", MUTED),
      ("", TEXT),
      ("  LED2 on PG10: toggled instantly  ⚡", OK_GREEN),
      ("  (normally would wait ~4.5 seconds)", MUTED)],
     None, (74,), 45),

    ([("  > evaluate('count = 9')", TOOL),
      ("  ✓ count = 9", OK_GREEN),
      ("", TEXT),
      ("  LED2 on PG10: toggled instantly  ⚡", OK_GREEN),
      ("  (normally would wait ~4.5 seconds)", MUTED),
      ("", TEXT),
      ("Claude:  Done. Bug confirmed — the counter", CLAUDE),
      ("         logic is correct. AI debugged the", CLAUDE),
      ("         hardware live, no reflash needed. 🎯", CLAUDE)],
     None, (74,), 60),
]

frames = []
for lines, hl, bps, count in script:
    img = make_frame(lines, hl, bps)
    for _ in range(count):
        frames.append(img)

# ─── Part 2: Peripheral Tester scenes ──────────────────────────────────────
# Title card / transition
def make_title_frame(title, subtitle):
    img = Image.new("RGB", (W, H), PT_BG)
    draw = ImageDraw.Draw(img)
    tw = draw.textlength(title, font=FONT_BOLD)
    draw.text(((W - tw) // 2, H // 2 - 40), title, font=FONT_BOLD, fill=PT_ACCENT)
    big_font = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 22)
    tw2 = draw.textlength(title, font=big_font)
    draw.text(((W - tw2) // 2, H // 2 - 20), title, font=big_font, fill=PT_ACCENT)
    sw = draw.textlength(subtitle, font=FONT_REG)
    draw.text(((W - sw) // 2, H // 2 + 15), subtitle, font=FONT_REG, fill=TEXT)
    draw.text(((W - sw) // 2, H // 2 + 40),
              "— no firmware required —", font=FONT_REG, fill=MUTED)
    status_bar(draw, "  Feature 2 / 2  |  Peripheral Tester")
    return img

title_img = make_title_frame("Peripheral Tester",
                              "Configure GPIO, SPI, I2C, USART, CAN, RTC, PWM via OpenOCD")
for _ in range(25):
    frames.append(title_img)

# Scene: empty UI, idle
log_empty = [("Peripheral Tester ready. Click \"Detect chip\" to start.", PT_ACCENT)]
frames.extend([make_pt_frame(log_lines=log_empty)] * 15)

# Scene: Detect clicked
log_detect = [
    ("Peripheral Tester ready. Click \"Detect chip\" to start.", PT_ACCENT),
    ("> Detectando chip...", PT_ACCENT),
    ("[ocd] device id = 0x20036413", TEXT),
    ("[ocd] flash size = 1024 KiB", TEXT),
    ("-> stm32f4x.cpu  family=stm32f4  state=halted", PT_GREEN),
]
frames.extend([make_pt_frame(log_lines=log_detect)] * 25)

# Scene: Init pin clicked
log_init = log_detect + [
    ("", TEXT),
    ("> Init pin PA5 as Output", PT_ACCENT),
]
frames.extend([make_pt_frame(log_lines=log_init, active_btn="init")] * 12)

log_init_ok = log_init + [
    ("OK initGpio: { pin: 'PA5', mode: 'output', pull: 'none' }", PT_GREEN),
]
frames.extend([make_pt_frame(log_lines=log_init_ok)] * 20)

# Scene: Set HIGH
log_high = log_init_ok + [
    ("", TEXT),
    ("> Set PA5 HIGH", PT_ACCENT),
    ("OK setGpio: { pin: 'PA5', value: 'HIGH' }  -- LED ON", PT_GREEN),
]
frames.extend([make_pt_frame(gpio_state='high', log_lines=log_high, active_btn="high")] * 35)

# Scene: Set LOW
log_low = log_high + [
    ("> Set PA5 LOW", PT_ACCENT),
    ("OK setGpio: { pin: 'PA5', value: 'LOW' }   -- LED OFF", PT_GREEN),
]
# Trim log so it fits
log_low = log_low[-7:]
frames.extend([make_pt_frame(gpio_state='low', log_lines=log_low, active_btn="low")] * 30)

# Scene: Set HIGH again (toggle demo)
log_toggle = log_low + [
    ("> Set PA5 HIGH", PT_ACCENT),
    ("OK setGpio: { pin: 'PA5', value: 'HIGH' }  -- LED ON", PT_GREEN),
]
log_toggle = log_toggle[-7:]
frames.extend([make_pt_frame(gpio_state='high', log_lines=log_toggle, active_btn="high")] * 25)

# Final closing card
def make_closing():
    img = Image.new("RGB", (W, H), PT_BG)
    draw = ImageDraw.Draw(img)
    big = ImageFont.truetype("C:/Windows/Fonts/consolab.ttf", 24)
    line1 = "Embedded AI Debug"
    line2 = "Two features, one extension:"
    line3 = "1. MCP bridge for Claude Code"
    line4 = "2. Peripheral Tester (no firmware)"
    line5 = "marketplace.visualstudio.com/items?itemName=paulopalaoro.embedded-ai-debug"
    tw = draw.textlength(line1, font=big)
    draw.text(((W - tw) // 2, 130), line1, font=big, fill=PT_ACCENT)
    for i, ln in enumerate([line2, "", line3, line4]):
        tw = draw.textlength(ln, font=FONT_REG)
        draw.text(((W - tw) // 2, 190 + i * 28), ln, font=FONT_REG, fill=TEXT)
    tw = draw.textlength(line5, font=FONT_SMALL)
    draw.text(((W - tw) // 2, H - 60), line5, font=FONT_SMALL, fill=MUTED)
    status_bar(draw, "  github.com/paulopalaoro/cortex-mcp-bridge")
    return img

frames.extend([make_closing()] * 50)

frames[0].save(
    OUT,
    save_all=True,
    append_images=frames[1:],
    duration=80,
    loop=0,
    optimize=True,
)
print(f"[OK] GIF saved: {OUT} ({len(frames)} frames, ~{len(frames) * 80 / 1000:.1f}s)")
