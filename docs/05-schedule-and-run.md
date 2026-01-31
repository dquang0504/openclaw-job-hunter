# Step 5: Schedule & Run the Job Search

## 5.1 Set Up Cron Schedule

SSH into your Azure VM and edit crontab:

```bash
crontab -e
```

Add this line (runs at 6am, 10am, 2pm, 6pm, 10pm Vietnam time):

```cron
0 6,10,14,18,22 * * * cd /home/azureuser/openclaw-automation && /usr/bin/node execution/job-search.js >> logs/cron.log 2>&1
```

Save and exit.

## 5.2 Manual Test Run

Before enabling cron, test manually:

```bash
cd ~/openclaw-automation

# Dry run (doesn't send to Telegram)
node execution/job-search.js --dry-run --platform=topcv

# Test Telegram integration
node execution/job-search.js --platform=topcv
```

## 5.3 View Logs

```bash
# Real-time log monitoring
tail -f logs/job-search.log

# Today's results
cat logs/job-search-$(date +%Y-%m-%d).json | jq '.'

# Check cron execution
grep CRON /var/log/syslog | tail -20
```

## 5.4 Start VM After Auto-Shutdown

When Azure auto-shuts down your VM at 1 AM, start it next day:

1. Azure Portal → Your VM → **Start**
2. Or use Azure CLI:
   ```bash
   az vm start --resource-group openclaw-rg --name openclaw-vm
   ```

The cron job will automatically run at the next scheduled time.

---

## Quick Reference

| Command | Purpose |
|---------|---------|
| `node execution/job-search.js` | Run full search |
| `node execution/job-search.js --dry-run` | Test without Telegram |
| `node execution/job-search.js --platform=topcv` | TopCV only |
| `node execution/job-search.js --platform=twitter` | X only |
| `crontab -l` | View scheduled jobs |
| `tail -f logs/job-search.log` | Live logs |
