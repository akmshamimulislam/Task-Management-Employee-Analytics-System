import json
import os
import sys
from datetime import datetime
from zk import ZK, const
from google.oauth2 import service_account
from googleapiclient.discovery import build
import pandas as pd

def load_config():
    try:
        with open('config.json', 'r') as f:
            return json.load(f)
    except FileNotFoundError:
        print("Error: config.json not found. Please create it based on config.json.template.")
        sys.exit(1)

def get_zk_attendance(ip, port=4370):
    zk = ZK(ip, port=port, timeout=5, password=0, force_udp=False, ommit_ping=False)
    conn = None
    try:
        print(f"Connecting to ZKTeco at {ip}:{port}...")
        conn = zk.connect()
        print("Connected. Fetching attendance records...")
        attendance = conn.get_attendance()

        records = []
        for record in attendance:
            records.append({
                'Employee ID': record.user_id,
                'Timestamp': record.timestamp
            })
        return records
    except Exception as e:
        print(f"Error connecting to ZKTeco: {e}")
        return []
    finally:
        if conn:
            conn.disconnect()

def sync_to_google_sheets(records, config):
    if not records:
        print("No records to sync.")
        return

    # Process records into daily clock-in/out
    df = pd.DataFrame(records)
    df['Date'] = df['Timestamp'].dt.date
    df['Time'] = df['Timestamp'].dt.time

    # Sort to get first and last punch per day
    df = df.sort_values(['Employee ID', 'Timestamp'])

    daily = df.groupby(['Employee ID', 'Date']).agg(
        Clock_In=('Timestamp', 'min'),
        Clock_Out=('Timestamp', 'max')
    ).reset_index()

    # Calculate Total Hours
    daily['Total_Hours'] = (daily['Clock_Out'] - daily['Clock_In']).dt.total_seconds() / 3600
    daily['Total_Hours'] = daily['Total_Hours'].round(2)

    # Format for Sheets
    sheet_data = []
    # Headers should match dashboard expectations
    # Expected columns: Employee ID, Name, Date, Clock In, Clock Out, Total Hours
    # Note: Name is usually in a separate sheet or hardcoded. We'll leave it empty or map if possible.

    for _, row in daily.iterrows():
        sheet_data.append([
            row['Employee ID'],
            "", # Name placeholder
            row['Date'].isoformat(),
            row['Clock_In'].strftime('%H:%M:%S'),
            row['Clock_Out'].strftime('%H:%M:%S'),
            row['Total_Hours']
        ])

    # Google Sheets Auth
    creds = service_account.Credentials.from_service_account_file(
        config['google_service_account_file'],
        scopes=['https://www.googleapis.com/auth/spreadsheets']
    )
    service = build('sheets', 'v4', credentials=creds)

    spreadsheet_id = config['google_sheet_id']
    range_name = f"{config['google_sheet_name']}!A2" # Start appending from A2

    body = {
        'values': sheet_data
    }

    print(f"Syncing {len(sheet_data)} daily records to Google Sheets...")
    result = service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id, range=range_name,
        valueInputOption='RAW', body=body).execute()
    print(f"{result.get('updates').get('updatedCells')} cells updated.")

def main():
    config = load_config()
    records = get_zk_attendance(config['zk_ip'], config.get('zk_port', 4370))
    if records:
        sync_to_google_sheets(records, config)
    else:
        print("Failed to retrieve attendance from device.")

if __name__ == "__main__":
    main()
