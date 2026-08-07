#!/bin/bash
# Utilidad: listar / borrar campañas en la cuenta de Tierra de Mascotas
source "$(dirname "$0")/env.sh"
AT=$(/usr/bin/curl -s -X POST https://oauth2.googleapis.com/token -d "client_id=$GOOGLE_CLIENT_ID&client_secret=$GOOGLE_CLIENT_SECRET&refresh_token=$GADS_RT&grant_type=refresh_token" | python3 -c "import json,sys; print(json.load(sys.stdin)['access_token'])")
CID=3826364131
case "$1" in
  lista)
    /usr/bin/curl -s -X POST "https://googleads.googleapis.com/v21/customers/$CID/googleAds:search" \
      -H "Authorization: Bearer $AT" -H "developer-token: $GOOGLE_ADS_DEVELOPER_TOKEN" \
      -H "login-customer-id: $GOOGLE_ADS_MCC_ID" -H "Content-Type: application/json" \
      -d '{"query":"SELECT campaign.id, campaign.name, campaign.status, campaign.start_date FROM campaign ORDER BY campaign.id DESC"}' \
    | python3 -c "
import json,sys
for r in json.load(sys.stdin).get('results',[]):
    c=r['campaign']; print(c['id'],'|',c['status'],'|',c.get('startDate',''),'|',c['name'])"
    ;;
  borrar)
    /usr/bin/curl -s -X POST "https://googleads.googleapis.com/v21/customers/$CID/campaigns:mutate" \
      -H "Authorization: Bearer $AT" -H "developer-token: $GOOGLE_ADS_DEVELOPER_TOKEN" \
      -H "login-customer-id: $GOOGLE_ADS_MCC_ID" -H "Content-Type: application/json" \
      -d "{\"operations\":[{\"remove\":\"customers/$CID/campaigns/$2\"}]}" | head -c 300; echo
    ;;
esac
