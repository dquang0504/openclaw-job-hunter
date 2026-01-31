# Step 2: Create Azure B2s VM (Azure for Students)

## 2.1 Access Azure Portal

1. Go to [portal.azure.com](https://portal.azure.com)
2. Sign in with your student account

## 2.2 Create Virtual Machine

1. Click **"Create a resource"** → **"Virtual Machine"**
2. Configure **Basics** tab:

| Setting | Value |
|---------|-------|
| Subscription | Azure for Students |
| Resource group | Create new: `openclaw-rg` |
| VM name | `openclaw-vm` |
| Region | `(Asia Pacific) Southeast Asia` (Singapore, closest to VN) |
| Image | `Ubuntu 24.04 LTS - x64 Gen2` |
| Size | Click "See all sizes" → search `B2s` → Select `Standard_B2s` (2 vCPU, 4 GiB) |
| Authentication | SSH public key |
| Username | `azureuser` |
| SSH key source | Generate new key pair |

3. **Disks** tab: Leave defaults (Standard SSD, 30GB)

4. **Networking** tab:
   - Public IP: Create new
   - NIC security group: Basic
   - Public inbound ports: Allow SSH (22)

5. Click **"Review + create"** → **"Create"**

6. **Download the SSH private key** when prompted (save as `openclaw-vm_key.pem`)

## 2.3 Configure Auto-Shutdown (Save Credits!)

1. Go to your VM → **Operations** → **Auto-shutdown**
2. Enable: **On**
3. Scheduled shutdown: `01:00`
4. Timezone: `(UTC+07:00) Bangkok, Hanoi, Jakarta`
5. **Save**

## 2.4 Connect to Your VM

```bash
# Set permissions on your key
chmod 400 ~/Downloads/openclaw-vm_key.pem

# Connect via SSH
ssh -i ~/Downloads/openclaw-vm_key.pem azureuser@<YOUR_VM_PUBLIC_IP>
```

Find your VM's public IP in Azure Portal → VM Overview → Public IP address.

---

## Estimated Costs

| Resource | Cost |
|----------|------|
| B2s VM (running ~12 hrs/day) | ~$7-8/month |
| Standard SSD 30GB | ~$1.50/month |
| **Total** | **~$9/month** |

With auto-shutdown at 1 AM, you'll preserve your $100 student credit well.
