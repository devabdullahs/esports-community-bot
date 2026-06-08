# EWC Prediction Dashboard

Next.js App Router dashboard for EWC prediction leaderboards and Discord profile showcase sync.

```bash
npm run web:auth:migrate
npm run web:dev
```

The app shares `DB_PATH` with the Discord bot and exposes internal sync endpoints protected by
`EWC_DASHBOARD_INTERNAL_SECRET`.
