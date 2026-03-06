# e-Consul Monitor

**Automated slot monitoring and booking for Ukrainian consular services (e-consul.gov.ua)**

**Автоматичний моніторинг та бронювання слотів на консульські послуги України (e-consul.gov.ua)**

---

## Features | Можливості

### EN
- Real-time slot monitoring across multiple consulates
- Two modes: **Search** (notify only) and **Book** (auto-booking)
- Telegram notifications for new slots and booking confirmations
- BankID authentication (Monobank, PrivatBank, Oschadbank)
- Configurable time intervals for preferred booking windows
- Cross-platform: macOS, Windows, Linux

### UA
- Моніторинг слотів у реальному часі по кількох консульствах
- Два режими: **Шукати** (тільки сповіщення) та **Бронювати** (автобронювання)
- Telegram-сповіщення про нові слоти та підтвердження бронювання
- Авторизація через BankID (Монобанк, ПриватБанк, Ощадбанк)
- Налаштування бажаного інтервалу часу для бронювання
- Кросплатформний: macOS, Windows, Linux

---

## How It Works | Як це працює

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Electron   │────▶│  e-consul    │────▶│   Telegram   │
│   Desktop    │◀────│  API         │     │   Bot        │
│   App        │     │              │     │              │
└──────┬───────┘     └──────────────┘     └──────────────┘
       │
       ▼
  ┌──────────┐
  │  BankID  │
  │  Auth    │
  └──────────┘
```

### EN
1. **Authenticate** — app opens BankID login, sends auth link to Telegram
2. **Monitor** — polls consular schedules via API, calculates free slots
3. **Notify** — sends Telegram alert when new slots appear
4. **Book** (optional) — automatically books the first matching slot in your preferred time window

### UA
1. **Авторизація** — додаток відкриває BankID, надсилає лінк авторизації у Telegram
2. **Моніторинг** — опитує розклад консульств через API, рахує вільні слоти
3. **Сповіщення** — надсилає alert у Telegram коли з'являються нові слоти
4. **Бронювання** (опціонально) — автоматично бронює перший підходящий слот у вашому інтервалі часу

---

## Quick Start | Швидкий старт

### Prerequisites | Вимоги
- Node.js 20+
- Telegram Bot (create via [@BotFather](https://t.me/BotFather))

### Install & Run | Встановлення та запуск

```bash
cd electron
npm install
npm run dev
```

### Setup | Налаштування

1. **Користувач** tab — fill personal data, select country, consulate, service
2. **Налаштування** tab — set Telegram bot token & chat ID, select bank for auth
3. **Монітор** tab — choose Search/Book mode, click **Старт**

---

## Build | Збірка

### Local build | Локальна збірка

```bash
cd electron
npm run build
# Output: electron/release/
```

### CI/CD (GitHub Actions)

Push a tag or trigger manually:

```bash
git tag v1.0.0
git push origin --tags
```

Builds `.dmg` (macOS), `.exe` (Windows), `.AppImage` (Linux) automatically.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop | Electron 28 |
| UI | React 18 + Tailwind CSS |
| Build | Vite + electron-builder |
| API | e-consul.gov.ua REST API |
| Auth | BankID via id.gov.ua |
| Notifications | Telegram Bot API |
| CI/CD | GitHub Actions |

---

## Project Structure

```
electron/
├── main.js                  # Electron main process
├── preload.js               # IPC bridge
├── src/
│   ├── App.jsx              # Root component
│   ├── screens/
│   │   ├── MainScreen.jsx   # Monitor + mode switcher
│   │   ├── UserFormScreen.jsx # Personal data & consulate
│   │   └── SettingsScreen.jsx # Telegram & auth config
│   ├── components/
│   │   ├── LogPanel.jsx     # Real-time log viewer
│   │   └── StatusBadge.jsx  # Status indicator
│   ├── lib/
│   │   ├── eQueueApi.js     # e-consul API client
│   │   ├── slotMonitor.js   # Slot monitoring engine
│   │   ├── slotCalculator.js # Free slot calculation
│   │   ├── bookingService.js # API-based booking (4 phases)
│   │   ├── bookingEngine.js  # BankID auth flow
│   │   ├── telegramNotifier.js # Telegram notifications
│   │   └── configStore.js   # Persistent config
│   └── utils/
│       └── consulatesData.js # Static consulate directory
├── electron-builder.yml     # Build config (mac/win/linux)
└── package.json
```

---

## Disclaimer | Застереження

**EN:** This project is created for **educational and research purposes only**. It demonstrates Electron app architecture, API integration patterns, and browser automation techniques. The authors are not responsible for any misuse.

**UA:** Цей проєкт створено **виключно в освітніх та дослідницьких цілях**. Він демонструє архітектуру Electron додатків, патерни інтеграції з API та техніки браузерної автоматизації. Автори не несуть відповідальності за будь-яке неправомірне використання.

## License

MIT