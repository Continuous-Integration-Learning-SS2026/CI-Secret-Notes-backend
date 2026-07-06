#!/usr/bin/env bash
# One-time EC2 host preparation for running the app + Jenkins + SonarQube
# all on this single Ubuntu instance (sized as m7i-flex.large, 8GiB RAM,
# free-tier eligible). Safe to re-run (idempotent-ish).
set -euo pipefail

echo "== Installing git (if missing) =="
sudo apt-get update -y
sudo apt-get install -y git

echo "== Confirming Docker Compose v2 plugin =="
docker compose version || { echo "Docker Compose v2 plugin missing - install docker-compose-plugin"; exit 1; }

echo "== Raising vm.max_map_count for SonarQube's embedded Elasticsearch =="
sudo sysctl -w vm.max_map_count=262144
if ! grep -q "vm.max_map_count" /etc/sysctl.conf; then
  echo "vm.max_map_count=262144" | sudo tee -a /etc/sysctl.conf
fi

echo "== Raising fs.file-max (SonarQube also wants generous file descriptors) =="
sudo sysctl -w fs.file-max=65536
if ! grep -q "fs.file-max" /etc/sysctl.conf; then
  echo "fs.file-max=65536" | sudo tee -a /etc/sysctl.conf
fi

echo "== Adding a swap file =="
if [ ! -f /swapfile ]; then
  sudo fallocate -l 2G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo "/swapfile none swap sw 0 0" | sudo tee -a /etc/fstab
else
  echo "Swapfile already exists, skipping."
fi

echo "== Done. Recommended next steps =="
echo "1. Open EC2 security group inbound rules for: 8080 (Jenkins), 9000 (SonarQube) - restrict source to your IP, not 0.0.0.0/0."
echo "2. Clone BOTH repos as siblings under the home directory."
echo "3. From ~/CI-Secret-Notes-backend, put real DB creds in .env, then bring up docker-compose.prod.yml and docker-compose.tooling.yml."