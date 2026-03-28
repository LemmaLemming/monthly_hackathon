#!/usr/bin/env python3
"""
UVic Healthcare AI Hackathon - Synthetic Data Setup Tool
=========================================================
University of Victoria, BC, Canada — March 27-28, 2026

Generates a complete synthetic healthcare dataset for a 12-hour hackathon.
All data is fictional but medically coherent for ML training purposes.

Usage:
    pip install pandas numpy faker requests openpyxl
    python hackathon_data_setup.py
    python hackathon_data_setup.py --offline
    python hackathon_data_setup.py --output-dir my-data --offline
"""

import argparse
import io
import json
import os
import string
import sys
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from faker import Faker

# ---------------------------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------------------------

RANDOM_SEED = 42

# -- Victoria-area Forward Sortation Areas --
VICTORIA_FSAS: List[str] = [
    "V8N", "V8P", "V8R", "V8S", "V8T",
    "V8V", "V8W", "V8X", "V8Z", "V9A", "V9B", "V9C",
]

# -- Blood type distribution --
BLOOD_TYPES: List[str] = ["O+", "A+", "B+", "AB+", "O-", "A-", "B-", "AB-"]
BLOOD_TYPE_WEIGHTS: List[float] = [0.37, 0.36, 0.08, 0.03, 0.07, 0.06, 0.02, 0.01]

# -- Primary languages --
LANGUAGES: List[str] = ["English", "French", "Mandarin", "Punjabi", "Other"]
LANGUAGE_WEIGHTS: List[float] = [0.90, 0.05, 0.02, 0.02, 0.01]

# -- Facilities --
FACILITIES: List[str] = [
    "Royal Jubilee Hospital",
    "Victoria General Hospital",
    "Saanich Peninsula Hospital",
    "Cowichan District Hospital",
    "Nanaimo Regional General Hospital",
]
FACILITY_WEIGHTS: List[float] = [0.35, 0.30, 0.15, 0.10, 0.10]

# -- Encounter types --
ENCOUNTER_TYPES: List[str] = ["emergency", "outpatient", "inpatient"]
ENCOUNTER_TYPE_WEIGHTS: List[float] = [0.20, 0.55, 0.25]

# -- CTAS triage levels (1 = resuscitation, 5 = non-urgent) --
CTAS_LEVELS: List[int] = [1, 2, 3, 4, 5]
CTAS_WEIGHTS: List[float] = [0.05, 0.15, 0.45, 0.25, 0.10]

# -- Dispositions --
DISPOSITIONS: List[str] = [
    "discharged", "admitted", "transferred",
    "left AMA", "deceased", "observation",
]
DISPOSITION_WEIGHTS: List[float] = [0.60, 0.25, 0.05, 0.03, 0.01, 0.06]

# -- Diagnosis definitions: (code, description, weight, chief_complaint, ctas_bias) --
#    ctas_bias: tuple (shift, spread) applied to default CTAS weights
#    shift < 0 → more severe; shift > 0 → less severe
DIAGNOSES: List[Dict[str, Any]] = [
    {"code": "J06.9", "desc": "Acute upper respiratory infection", "weight": 0.12,
     "complaint": "cough and cold symptoms", "ctas_bias": (1, 0)},
    {"code": "I10", "desc": "Essential hypertension", "weight": 0.10,
     "complaint": "headache", "ctas_bias": (1, 0)},
    {"code": "E11.9", "desc": "Type 2 diabetes mellitus", "weight": 0.08,
     "complaint": "dizziness", "ctas_bias": (0, 0)},
    {"code": "M54.5", "desc": "Low back pain", "weight": 0.07,
     "complaint": "back pain", "ctas_bias": (1, 0)},
    {"code": "F32.9", "desc": "Major depressive disorder", "weight": 0.06,
     "complaint": "anxiety/depression", "ctas_bias": (0, 0)},
    {"code": "K21.0", "desc": "Gastroesophageal reflux disease", "weight": 0.05,
     "complaint": "nausea and vomiting", "ctas_bias": (1, 0)},
    {"code": "J45.9", "desc": "Asthma", "weight": 0.05,
     "complaint": "shortness of breath", "ctas_bias": (0, 0)},
    {"code": "R07.9", "desc": "Chest pain, unspecified", "weight": 0.04,
     "complaint": "chest pain", "ctas_bias": (-1, 0)},
    {"code": "INJURY", "desc": "Various injuries", "weight": 0.08,
     "complaint": "injury from fall", "ctas_bias": (0, 0)},
    {"code": "N39.0", "desc": "Urinary tract infection", "weight": 0.04,
     "complaint": "urinary symptoms", "ctas_bias": (1, 0)},
    {"code": "J18.9", "desc": "Pneumonia, unspecified", "weight": 0.03,
     "complaint": "shortness of breath", "ctas_bias": (-1, 0)},
    {"code": "K35.9", "desc": "Acute appendicitis", "weight": 0.02,
     "complaint": "abdominal pain", "ctas_bias": (-1, 0)},
    {"code": "I21.9", "desc": "Acute myocardial infarction", "weight": 0.01,
     "complaint": "chest pain", "ctas_bias": (-2, 0)},
    {"code": "R10.9", "desc": "Abdominal pain, unspecified", "weight": 0.05,
     "complaint": "abdominal pain", "ctas_bias": (0, 0)},
    {"code": "G43.9", "desc": "Migraine", "weight": 0.03,
     "complaint": "headache", "ctas_bias": (1, 0)},
    {"code": "L30.9", "desc": "Dermatitis, unspecified", "weight": 0.03,
     "complaint": "skin rash", "ctas_bias": (2, 0)},
    {"code": "OTHER", "desc": "Other diagnosis", "weight": 0.14,
     "complaint": "fever", "ctas_bias": (0, 0)},
]

# -- Injury ICD-10 codes for the INJURY category --
INJURY_CODES: List[Tuple[str, str]] = [
    ("S00.0", "Superficial injury of scalp"),
    ("S01.0", "Open wound of scalp"),
    ("S02.0", "Fracture of skull vault"),
    ("S06.0", "Concussion"),
    ("S22.3", "Fracture of rib"),
    ("S42.0", "Fracture of clavicle"),
    ("S52.5", "Fracture of lower end of radius"),
    ("S62.0", "Fracture of navicular bone of hand"),
    ("S72.0", "Fracture of neck of femur"),
    ("S82.0", "Fracture of patella"),
    ("S93.4", "Sprain of ankle"),
    ("S61.0", "Open wound of finger"),
    ("S80.0", "Contusion of knee"),
    ("S90.0", "Contusion of ankle"),
    ("S70.0", "Contusion of hip"),
]

# -- Other ICD-10 codes for the OTHER category --
OTHER_CODES: List[Tuple[str, str]] = [
    ("J20.9", "Acute bronchitis"),
    ("H10.9", "Conjunctivitis"),
    ("B34.9", "Viral infection, unspecified"),
    ("R51", "Headache"),
    ("M25.5", "Pain in joint"),
    ("R11.0", "Nausea"),
    ("K59.0", "Constipation"),
    ("R42", "Dizziness and giddiness"),
    ("J02.9", "Acute pharyngitis"),
    ("H66.9", "Otitis media"),
    ("R05", "Cough"),
    ("M79.3", "Panniculitis, unspecified"),
    ("R50.9", "Fever, unspecified"),
    ("L03.9", "Cellulitis"),
    ("N20.0", "Calculus of kidney"),
    ("E78.5", "Hyperlipidemia"),
    ("G47.0", "Insomnia"),
    ("M17.1", "Primary osteoarthritis of knee"),
    ("J30.1", "Allergic rhinitis due to pollen"),
    ("R00.0", "Tachycardia"),
]

# -- Other chief complaints --
OTHER_COMPLAINTS: List[str] = [
    "chest pain", "shortness of breath", "abdominal pain", "headache",
    "back pain", "cough and cold symptoms", "anxiety/depression", "skin rash",
    "injury from fall", "urinary symptoms", "joint pain", "dizziness",
    "fever", "nausea and vomiting", "wound/laceration",
]

# -- Drugs with metadata --
DRUGS: List[Dict[str, Any]] = [
    {"name": "metformin", "dosages": ["500mg", "850mg", "1000mg"],
     "freq": "twice daily", "route": "oral", "indication": "E11.9"},
    {"name": "lisinopril", "dosages": ["5mg", "10mg", "20mg"],
     "freq": "once daily", "route": "oral", "indication": "I10"},
    {"name": "atorvastatin", "dosages": ["10mg", "20mg", "40mg", "80mg"],
     "freq": "once daily", "route": "oral", "indication": "E78.5"},
    {"name": "levothyroxine", "dosages": ["25mcg", "50mcg", "75mcg", "100mcg"],
     "freq": "once daily", "route": "oral", "indication": "E03.9"},
    {"name": "amlodipine", "dosages": ["5mg", "10mg"],
     "freq": "once daily", "route": "oral", "indication": "I10"},
    {"name": "omeprazole", "dosages": ["20mg", "40mg"],
     "freq": "once daily", "route": "oral", "indication": "K21.0"},
    {"name": "salbutamol", "dosages": ["100mcg/puff"],
     "freq": "as needed", "route": "inhaled", "indication": "J45.9"},
    {"name": "rosuvastatin", "dosages": ["5mg", "10mg", "20mg"],
     "freq": "once daily", "route": "oral", "indication": "E78.5"},
    {"name": "ramipril", "dosages": ["2.5mg", "5mg", "10mg"],
     "freq": "once daily", "route": "oral", "indication": "I10"},
    {"name": "pantoprazole", "dosages": ["20mg", "40mg"],
     "freq": "once daily", "route": "oral", "indication": "K21.0"},
    {"name": "metoprolol", "dosages": ["25mg", "50mg", "100mg"],
     "freq": "twice daily", "route": "oral", "indication": "I10"},
    {"name": "hydrochlorothiazide", "dosages": ["12.5mg", "25mg"],
     "freq": "once daily", "route": "oral", "indication": "I10"},
    {"name": "sertraline", "dosages": ["25mg", "50mg", "100mg"],
     "freq": "once daily", "route": "oral", "indication": "F32.9"},
    {"name": "escitalopram", "dosages": ["5mg", "10mg", "20mg"],
     "freq": "once daily", "route": "oral", "indication": "F32.9"},
    {"name": "gabapentin", "dosages": ["100mg", "300mg", "600mg"],
     "freq": "three times daily", "route": "oral", "indication": "G43.9"},
    {"name": "amoxicillin", "dosages": ["250mg", "500mg"],
     "freq": "three times daily", "route": "oral", "indication": "J06.9"},
    {"name": "azithromycin", "dosages": ["250mg", "500mg"],
     "freq": "once daily", "route": "oral", "indication": "J18.9"},
    {"name": "prednisone", "dosages": ["5mg", "10mg", "20mg", "50mg"],
     "freq": "once daily", "route": "oral", "indication": "J45.9"},
    {"name": "acetaminophen", "dosages": ["325mg", "500mg", "650mg"],
     "freq": "as needed", "route": "oral", "indication": "M54.5"},
    {"name": "ibuprofen", "dosages": ["200mg", "400mg", "600mg"],
     "freq": "as needed", "route": "oral", "indication": "M54.5"},
    {"name": "warfarin", "dosages": ["1mg", "2mg", "5mg"],
     "freq": "once daily", "route": "oral", "indication": "I21.9"},
    {"name": "insulin glargine", "dosages": ["10 units", "20 units", "30 units"],
     "freq": "once daily", "route": "subcutaneous", "indication": "E11.9"},
    {"name": "sitagliptin", "dosages": ["25mg", "50mg", "100mg"],
     "freq": "once daily", "route": "oral", "indication": "E11.9"},
    {"name": "clopidogrel", "dosages": ["75mg"],
     "freq": "once daily", "route": "oral", "indication": "I21.9"},
    {"name": "furosemide", "dosages": ["20mg", "40mg", "80mg"],
     "freq": "once daily", "route": "oral", "indication": "I10"},
]

# -- Lab tests: (name, loinc, unit, ref_low, ref_high) --
LAB_TESTS: List[Dict[str, Any]] = [
    {"name": "Complete Blood Count", "loinc": "58410-2", "unit": "",
     "ref_low": None, "ref_high": None, "is_panel": True},
    {"name": "Hemoglobin", "loinc": "718-7", "unit": "g/L",
     "ref_low": 120.0, "ref_high": 170.0},
    {"name": "White Blood Cell Count", "loinc": "6690-2", "unit": "x10^9/L",
     "ref_low": 4.0, "ref_high": 11.0},
    {"name": "Glucose, Fasting", "loinc": "1558-6", "unit": "mmol/L",
     "ref_low": 3.9, "ref_high": 6.1},
    {"name": "HbA1c", "loinc": "4548-4", "unit": "%",
     "ref_low": 4.0, "ref_high": 6.0},
    {"name": "Creatinine", "loinc": "2160-0", "unit": "umol/L",
     "ref_low": 60.0, "ref_high": 110.0},
    {"name": "Sodium", "loinc": "2951-2", "unit": "mmol/L",
     "ref_low": 136.0, "ref_high": 145.0},
    {"name": "Potassium", "loinc": "2823-3", "unit": "mmol/L",
     "ref_low": 3.5, "ref_high": 5.0},
    {"name": "TSH", "loinc": "3016-3", "unit": "mIU/L",
     "ref_low": 0.4, "ref_high": 4.0},
    {"name": "ALT", "loinc": "1742-6", "unit": "U/L",
     "ref_low": 7.0, "ref_high": 56.0},
    {"name": "Total Cholesterol", "loinc": "2093-3", "unit": "mmol/L",
     "ref_low": 3.5, "ref_high": 5.2},
    {"name": "LDL Cholesterol", "loinc": "2089-1", "unit": "mmol/L",
     "ref_low": 1.5, "ref_high": 3.4},
    {"name": "Troponin I", "loinc": "10839-9", "unit": "ng/mL",
     "ref_low": 0.0, "ref_high": 0.04},
]

# -- Lab tests excluding panels (for value generation) --
LAB_TESTS_WITH_VALUES = [t for t in LAB_TESTS if not t.get("is_panel")]

# -- Drug-to-diagnosis mapping for medication correlation --
DIAGNOSIS_DRUG_MAP: Dict[str, List[str]] = {
    "E11.9": ["metformin", "insulin glargine", "sitagliptin"],
    "I10": ["lisinopril", "amlodipine", "ramipril", "metoprolol",
             "hydrochlorothiazide", "furosemide"],
    "F32.9": ["sertraline", "escitalopram"],
    "K21.0": ["omeprazole", "pantoprazole"],
    "J45.9": ["salbutamol", "prednisone"],
    "I21.9": ["clopidogrel", "warfarin", "metoprolol", "atorvastatin"],
    "M54.5": ["acetaminophen", "ibuprofen", "gabapentin"],
    "J06.9": ["amoxicillin", "acetaminophen"],
    "J18.9": ["azithromycin", "amoxicillin"],
    "G43.9": ["gabapentin", "acetaminophen", "ibuprofen"],
    "L30.9": ["prednisone"],
}

# -- BC Community Health Service Areas --
ISLAND_HEALTH_CHSAS: List[Dict[str, str]] = [
    {"code": "4101", "name": "Greater Victoria"},
    {"code": "4102", "name": "Saanich"},
    {"code": "4103", "name": "Western Communities"},
    {"code": "4104", "name": "Sooke"},
    {"code": "4105", "name": "Sidney"},
    {"code": "4106", "name": "Gulf Islands"},
    {"code": "4201", "name": "Cowichan"},
    {"code": "4202", "name": "Lake Cowichan"},
    {"code": "4203", "name": "Ladysmith"},
    {"code": "4301", "name": "Nanaimo"},
    {"code": "4302", "name": "Oceanside"},
    {"code": "4401", "name": "Alberni"},
    {"code": "4402", "name": "Tofino"},
    {"code": "4501", "name": "Comox Valley"},
    {"code": "4601", "name": "Campbell River"},
    {"code": "4701", "name": "North Island"},
]

OTHER_HA_CHSAS: List[Dict[str, Any]] = [
    {"code": "2301", "name": "Vancouver Downtown", "ha": "Vancouver Coastal"},
    {"code": "2302", "name": "Vancouver Westside", "ha": "Vancouver Coastal"},
    {"code": "2303", "name": "Vancouver Eastside", "ha": "Vancouver Coastal"},
    {"code": "2304", "name": "North Vancouver", "ha": "Vancouver Coastal"},
    {"code": "2305", "name": "West Vancouver", "ha": "Vancouver Coastal"},
    {"code": "2306", "name": "Richmond", "ha": "Vancouver Coastal"},
    {"code": "2307", "name": "Sunshine Coast", "ha": "Vancouver Coastal"},
    {"code": "3201", "name": "Surrey", "ha": "Fraser"},
    {"code": "3202", "name": "Langley", "ha": "Fraser"},
    {"code": "3203", "name": "Delta", "ha": "Fraser"},
    {"code": "3204", "name": "White Rock", "ha": "Fraser"},
    {"code": "3205", "name": "Burnaby", "ha": "Fraser"},
    {"code": "3206", "name": "New Westminster", "ha": "Fraser"},
    {"code": "3207", "name": "Tri-Cities", "ha": "Fraser"},
    {"code": "3208", "name": "Maple Ridge", "ha": "Fraser"},
    {"code": "3209", "name": "Abbotsford", "ha": "Fraser"},
    {"code": "3210", "name": "Chilliwack", "ha": "Fraser"},
    {"code": "3211", "name": "Mission", "ha": "Fraser"},
    {"code": "3212", "name": "Hope", "ha": "Fraser"},
    {"code": "1101", "name": "East Kootenay", "ha": "Interior"},
    {"code": "1102", "name": "Kootenay Lake", "ha": "Interior"},
    {"code": "1103", "name": "Trail", "ha": "Interior"},
    {"code": "1201", "name": "Okanagan-Similkameen", "ha": "Interior"},
    {"code": "1202", "name": "Penticton", "ha": "Interior"},
    {"code": "1203", "name": "Kelowna", "ha": "Interior"},
    {"code": "1204", "name": "Vernon", "ha": "Interior"},
    {"code": "1301", "name": "Kamloops", "ha": "Interior"},
    {"code": "1302", "name": "Merritt", "ha": "Interior"},
    {"code": "1401", "name": "Revelstoke", "ha": "Interior"},
    {"code": "1402", "name": "Salmon Arm", "ha": "Interior"},
    {"code": "1501", "name": "Cariboo-Chilcotin", "ha": "Interior"},
    {"code": "1502", "name": "Quesnel", "ha": "Interior"},
    {"code": "5101", "name": "Snow Country", "ha": "Northern"},
    {"code": "5201", "name": "Prince George", "ha": "Northern"},
    {"code": "5202", "name": "Nechako", "ha": "Northern"},
    {"code": "5203", "name": "Burns Lake", "ha": "Northern"},
    {"code": "5301", "name": "Prince Rupert", "ha": "Northern"},
    {"code": "5302", "name": "Terrace", "ha": "Northern"},
    {"code": "5303", "name": "Kitimat", "ha": "Northern"},
    {"code": "5401", "name": "Peace River South", "ha": "Northern"},
    {"code": "5402", "name": "Peace River North", "ha": "Northern"},
    {"code": "5403", "name": "Fort Nelson", "ha": "Northern"},
    {"code": "5501", "name": "Upper Skeena", "ha": "Northern"},
    {"code": "5502", "name": "Nisga'a", "ha": "Northern"},
    {"code": "5503", "name": "Telegraph Creek", "ha": "Northern"},
    {"code": "5601", "name": "Northeast", "ha": "Northern"},
]

# -- Canadian provinces --
PROVINCES: List[str] = [
    "BC", "AB", "SK", "MB", "ON", "QC", "NB", "NS", "PE", "NL",
]

# -- Wait time procedures --
WAIT_TIME_PROCEDURES: List[Dict[str, Any]] = [
    {"procedure": "Hip Replacement", "benchmark": 182,
     "base_median": 110, "base_volume": 5500},
    {"procedure": "Knee Replacement", "benchmark": 182,
     "base_median": 130, "base_volume": 7000},
    {"procedure": "Cataract Surgery", "benchmark": 112,
     "base_median": 75, "base_volume": 30000},
    {"procedure": "Radiation Therapy", "benchmark": 28,
     "base_median": 18, "base_volume": 4000},
    {"procedure": "Hip Fracture Repair", "benchmark": 2,
     "base_median": 1, "base_volume": 3000},
    {"procedure": "CT Scan", "benchmark": 30,
     "base_median": 15, "base_volume": 50000},
    {"procedure": "MRI Scan", "benchmark": 30,
     "base_median": 40, "base_volume": 20000},
    {"procedure": "Cardiac Bypass", "benchmark": 182,
     "base_median": 25, "base_volume": 2000},
]

# -- Additional drugs for the reference database (beyond the 25 core) --
ADDITIONAL_DRUGS: List[Dict[str, str]] = [
    {"name": "cephalexin", "generic": "cephalexin", "class": "Cephalosporin antibiotic",
     "indication": "Bacterial infections", "dosage": "500mg QID", "route": "oral", "schedule": "Prescription"},
    {"name": "ciprofloxacin", "generic": "ciprofloxacin", "class": "Fluoroquinolone antibiotic",
     "indication": "Bacterial infections", "dosage": "500mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "doxycycline", "generic": "doxycycline", "class": "Tetracycline antibiotic",
     "indication": "Bacterial infections", "dosage": "100mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "fluconazole", "generic": "fluconazole", "class": "Antifungal",
     "indication": "Fungal infections", "dosage": "150mg once", "route": "oral", "schedule": "Prescription"},
    {"name": "clindamycin", "generic": "clindamycin", "class": "Lincosamide antibiotic",
     "indication": "Bacterial infections", "dosage": "300mg QID", "route": "oral", "schedule": "Prescription"},
    {"name": "diclofenac", "generic": "diclofenac", "class": "NSAID",
     "indication": "Pain, inflammation", "dosage": "50mg TID", "route": "oral", "schedule": "Prescription"},
    {"name": "naproxen", "generic": "naproxen", "class": "NSAID",
     "indication": "Pain, inflammation", "dosage": "250mg BID", "route": "oral", "schedule": "OTC"},
    {"name": "celecoxib", "generic": "celecoxib", "class": "COX-2 inhibitor",
     "indication": "Pain, arthritis", "dosage": "200mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "morphine", "generic": "morphine sulfate", "class": "Opioid analgesic",
     "indication": "Severe pain", "dosage": "15mg Q4H", "route": "oral", "schedule": "Controlled"},
    {"name": "hydromorphone", "generic": "hydromorphone", "class": "Opioid analgesic",
     "indication": "Severe pain", "dosage": "2mg Q4H", "route": "oral", "schedule": "Controlled"},
    {"name": "oxycodone", "generic": "oxycodone", "class": "Opioid analgesic",
     "indication": "Moderate-severe pain", "dosage": "5mg Q6H", "route": "oral", "schedule": "Controlled"},
    {"name": "codeine", "generic": "codeine phosphate", "class": "Opioid analgesic",
     "indication": "Mild-moderate pain", "dosage": "30mg Q4H", "route": "oral", "schedule": "Controlled"},
    {"name": "tramadol", "generic": "tramadol", "class": "Opioid analgesic",
     "indication": "Moderate pain", "dosage": "50mg Q6H", "route": "oral", "schedule": "Prescription"},
    {"name": "duloxetine", "generic": "duloxetine", "class": "SNRI antidepressant",
     "indication": "Depression, neuropathic pain", "dosage": "60mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "venlafaxine", "generic": "venlafaxine", "class": "SNRI antidepressant",
     "indication": "Depression, anxiety", "dosage": "75mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "fluoxetine", "generic": "fluoxetine", "class": "SSRI antidepressant",
     "indication": "Depression, OCD", "dosage": "20mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "paroxetine", "generic": "paroxetine", "class": "SSRI antidepressant",
     "indication": "Depression, anxiety", "dosage": "20mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "citalopram", "generic": "citalopram", "class": "SSRI antidepressant",
     "indication": "Depression", "dosage": "20mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "mirtazapine", "generic": "mirtazapine", "class": "Tetracyclic antidepressant",
     "indication": "Depression", "dosage": "15mg at bedtime", "route": "oral", "schedule": "Prescription"},
    {"name": "trazodone", "generic": "trazodone", "class": "SARI antidepressant",
     "indication": "Depression, insomnia", "dosage": "50mg at bedtime", "route": "oral", "schedule": "Prescription"},
    {"name": "quetiapine", "generic": "quetiapine", "class": "Atypical antipsychotic",
     "indication": "Schizophrenia, bipolar", "dosage": "100mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "risperidone", "generic": "risperidone", "class": "Atypical antipsychotic",
     "indication": "Schizophrenia", "dosage": "2mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "lorazepam", "generic": "lorazepam", "class": "Benzodiazepine",
     "indication": "Anxiety, insomnia", "dosage": "1mg PRN", "route": "oral", "schedule": "Controlled"},
    {"name": "clonazepam", "generic": "clonazepam", "class": "Benzodiazepine",
     "indication": "Seizures, anxiety", "dosage": "0.5mg BID", "route": "oral", "schedule": "Controlled"},
    {"name": "zopiclone", "generic": "zopiclone", "class": "Cyclopyrrolone hypnotic",
     "indication": "Insomnia", "dosage": "7.5mg at bedtime", "route": "oral", "schedule": "Prescription"},
    {"name": "pregabalin", "generic": "pregabalin", "class": "Anticonvulsant",
     "indication": "Neuropathic pain, anxiety", "dosage": "75mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "topiramate", "generic": "topiramate", "class": "Anticonvulsant",
     "indication": "Epilepsy, migraine prevention", "dosage": "50mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "valproic acid", "generic": "valproic acid", "class": "Anticonvulsant",
     "indication": "Epilepsy, bipolar", "dosage": "500mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "levetiracetam", "generic": "levetiracetam", "class": "Anticonvulsant",
     "indication": "Epilepsy", "dosage": "500mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "allopurinol", "generic": "allopurinol", "class": "Xanthine oxidase inhibitor",
     "indication": "Gout", "dosage": "300mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "colchicine", "generic": "colchicine", "class": "Anti-gout",
     "indication": "Gout", "dosage": "0.6mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "montelukast", "generic": "montelukast", "class": "Leukotriene inhibitor",
     "indication": "Asthma, allergies", "dosage": "10mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "cetirizine", "generic": "cetirizine", "class": "Antihistamine",
     "indication": "Allergies", "dosage": "10mg daily", "route": "oral", "schedule": "OTC"},
    {"name": "loratadine", "generic": "loratadine", "class": "Antihistamine",
     "indication": "Allergies", "dosage": "10mg daily", "route": "oral", "schedule": "OTC"},
    {"name": "diphenhydramine", "generic": "diphenhydramine", "class": "Antihistamine",
     "indication": "Allergies, insomnia", "dosage": "25mg Q6H", "route": "oral", "schedule": "OTC"},
    {"name": "ranitidine", "generic": "ranitidine", "class": "H2 blocker",
     "indication": "GERD, peptic ulcer", "dosage": "150mg BID", "route": "oral", "schedule": "OTC"},
    {"name": "domperidone", "generic": "domperidone", "class": "Prokinetic",
     "indication": "Nausea, gastroparesis", "dosage": "10mg TID", "route": "oral", "schedule": "Prescription"},
    {"name": "ondansetron", "generic": "ondansetron", "class": "5-HT3 antagonist",
     "indication": "Nausea, vomiting", "dosage": "4mg PRN", "route": "oral", "schedule": "Prescription"},
    {"name": "metoclopramide", "generic": "metoclopramide", "class": "Prokinetic",
     "indication": "Nausea, GERD", "dosage": "10mg TID", "route": "oral", "schedule": "Prescription"},
    {"name": "bisoprolol", "generic": "bisoprolol", "class": "Beta blocker",
     "indication": "Hypertension, heart failure", "dosage": "5mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "candesartan", "generic": "candesartan", "class": "ARB",
     "indication": "Hypertension", "dosage": "16mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "valsartan", "generic": "valsartan", "class": "ARB",
     "indication": "Hypertension, heart failure", "dosage": "80mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "irbesartan", "generic": "irbesartan", "class": "ARB",
     "indication": "Hypertension", "dosage": "150mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "diltiazem", "generic": "diltiazem", "class": "Calcium channel blocker",
     "indication": "Hypertension, angina", "dosage": "180mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "spironolactone", "generic": "spironolactone", "class": "Potassium-sparing diuretic",
     "indication": "Heart failure, hypertension", "dosage": "25mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "apixaban", "generic": "apixaban", "class": "DOAC anticoagulant",
     "indication": "Atrial fibrillation, DVT", "dosage": "5mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "rivaroxaban", "generic": "rivaroxaban", "class": "DOAC anticoagulant",
     "indication": "Atrial fibrillation, DVT", "dosage": "20mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "ASA (aspirin)", "generic": "acetylsalicylic acid", "class": "NSAID / antiplatelet",
     "indication": "Pain, cardiovascular prevention", "dosage": "81mg daily", "route": "oral", "schedule": "OTC"},
    {"name": "nitroglycerin", "generic": "nitroglycerin", "class": "Nitrate vasodilator",
     "indication": "Angina", "dosage": "0.4mg SL PRN", "route": "sublingual", "schedule": "Prescription"},
    {"name": "empagliflozin", "generic": "empagliflozin", "class": "SGLT2 inhibitor",
     "indication": "Type 2 diabetes, heart failure", "dosage": "10mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "liraglutide", "generic": "liraglutide", "class": "GLP-1 receptor agonist",
     "indication": "Type 2 diabetes", "dosage": "1.2mg daily", "route": "subcutaneous", "schedule": "Prescription"},
    {"name": "gliclazide", "generic": "gliclazide", "class": "Sulfonylurea",
     "indication": "Type 2 diabetes", "dosage": "80mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "insulin aspart", "generic": "insulin aspart", "class": "Rapid-acting insulin",
     "indication": "Diabetes", "dosage": "variable", "route": "subcutaneous", "schedule": "Prescription"},
    {"name": "tiotropium", "generic": "tiotropium", "class": "Anticholinergic bronchodilator",
     "indication": "COPD", "dosage": "18mcg inhaled daily", "route": "inhaled", "schedule": "Prescription"},
    {"name": "fluticasone/salmeterol", "generic": "fluticasone/salmeterol", "class": "ICS/LABA",
     "indication": "Asthma, COPD", "dosage": "250/50mcg BID", "route": "inhaled", "schedule": "Prescription"},
    {"name": "budesonide", "generic": "budesonide", "class": "Inhaled corticosteroid",
     "indication": "Asthma", "dosage": "200mcg BID", "route": "inhaled", "schedule": "Prescription"},
    {"name": "tamsulosin", "generic": "tamsulosin", "class": "Alpha blocker",
     "indication": "BPH", "dosage": "0.4mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "finasteride", "generic": "finasteride", "class": "5-alpha reductase inhibitor",
     "indication": "BPH", "dosage": "5mg daily", "route": "oral", "schedule": "Prescription"},
    {"name": "sildenafil", "generic": "sildenafil", "class": "PDE5 inhibitor",
     "indication": "Erectile dysfunction", "dosage": "50mg PRN", "route": "oral", "schedule": "Prescription"},
    {"name": "methotrexate", "generic": "methotrexate", "class": "DMARD",
     "indication": "Rheumatoid arthritis", "dosage": "15mg weekly", "route": "oral", "schedule": "Prescription"},
    {"name": "hydroxychloroquine", "generic": "hydroxychloroquine", "class": "DMARD",
     "indication": "Rheumatoid arthritis, lupus", "dosage": "200mg BID", "route": "oral", "schedule": "Prescription"},
    {"name": "cyclobenzaprine", "generic": "cyclobenzaprine", "class": "Muscle relaxant",
     "indication": "Muscle spasm", "dosage": "10mg TID", "route": "oral", "schedule": "Prescription"},
    {"name": "baclofen", "generic": "baclofen", "class": "Muscle relaxant",
     "indication": "Muscle spasticity", "dosage": "10mg TID", "route": "oral", "schedule": "Prescription"},
    {"name": "sumatriptan", "generic": "sumatriptan", "class": "Triptan",
     "indication": "Migraine", "dosage": "50mg PRN", "route": "oral", "schedule": "Prescription"},
    {"name": "amitriptyline", "generic": "amitriptyline", "class": "Tricyclic antidepressant",
     "indication": "Depression, neuropathic pain", "dosage": "25mg at bedtime", "route": "oral", "schedule": "Prescription"},
    {"name": "nortriptyline", "generic": "nortriptyline", "class": "Tricyclic antidepressant",
     "indication": "Depression, neuropathic pain", "dosage": "25mg at bedtime", "route": "oral", "schedule": "Prescription"},
    {"name": "methylphenidate", "generic": "methylphenidate", "class": "CNS stimulant",
     "indication": "ADHD", "dosage": "10mg BID", "route": "oral", "schedule": "Controlled"},
    {"name": "beclomethasone", "generic": "beclomethasone", "class": "Nasal corticosteroid",
     "indication": "Allergic rhinitis", "dosage": "100mcg/spray BID", "route": "nasal", "schedule": "Prescription"},
    {"name": "latanoprost", "generic": "latanoprost", "class": "Prostaglandin analog",
     "indication": "Glaucoma", "dosage": "1 drop at bedtime", "route": "ophthalmic", "schedule": "Prescription"},
    {"name": "timolol ophthalmic", "generic": "timolol", "class": "Beta blocker (ophthalmic)",
     "indication": "Glaucoma", "dosage": "1 drop BID", "route": "ophthalmic", "schedule": "Prescription"},
    {"name": "betamethasone cream", "generic": "betamethasone valerate", "class": "Topical corticosteroid",
     "indication": "Eczema, dermatitis", "dosage": "Apply BID", "route": "topical", "schedule": "Prescription"},
    {"name": "mupirocin ointment", "generic": "mupirocin", "class": "Topical antibiotic",
     "indication": "Skin infections", "dosage": "Apply TID", "route": "topical", "schedule": "Prescription"},
    {"name": "ferrous sulfate", "generic": "ferrous sulfate", "class": "Iron supplement",
     "indication": "Iron deficiency anemia", "dosage": "300mg daily", "route": "oral", "schedule": "OTC"},
    {"name": "calcium carbonate", "generic": "calcium carbonate", "class": "Calcium supplement",
     "indication": "Calcium supplementation", "dosage": "500mg BID", "route": "oral", "schedule": "OTC"},
    {"name": "vitamin D3", "generic": "cholecalciferol", "class": "Vitamin",
     "indication": "Vitamin D deficiency", "dosage": "1000 IU daily", "route": "oral", "schedule": "OTC"},
    {"name": "folic acid", "generic": "folic acid", "class": "Vitamin B9",
     "indication": "Folate deficiency, pregnancy", "dosage": "1mg daily", "route": "oral", "schedule": "OTC"},
    {"name": "vitamin B12", "generic": "cyanocobalamin", "class": "Vitamin B12",
     "indication": "B12 deficiency", "dosage": "1000mcg daily", "route": "oral", "schedule": "OTC"},
]


# ---------------------------------------------------------------------------
# HELPER FUNCTIONS
# ---------------------------------------------------------------------------

def _make_postal_code(rng: np.random.Generator, fsa: str) -> str:
    """Generate a valid Canadian postal code in the given FSA."""
    d1 = str(rng.integers(0, 10))
    l1 = rng.choice(list("ABCEGHJKLMNPRSTVWXYZ"))
    d2 = str(rng.integers(0, 10))
    return f"{fsa} {d1}{l1}{d2}"


def _make_msp_number(rng: np.random.Generator) -> str:
    """Generate a BC MSP-style insurance number (10 digits, formatted 4-3-3)."""
    digits = "".join([str(rng.integers(0, 10)) for _ in range(10)])
    return f"{digits[:4]} {digits[4:7]} {digits[7:]}"


def _biased_ctas(rng: np.random.Generator, bias_shift: int) -> int:
    """Return a CTAS level with optional severity bias.

    bias_shift < 0 means more severe (lower CTAS number).
    bias_shift > 0 means less severe (higher CTAS number).
    """
    base = np.array(CTAS_WEIGHTS, dtype=float)
    if bias_shift != 0:
        shifted = np.zeros_like(base)
        for i in range(5):
            src = i - bias_shift
            if 0 <= src < 5:
                shifted[i] = base[src]
            elif src < 0:
                shifted[0] += base[i] if bias_shift < 0 else 0
            else:
                shifted[4] += base[i] if bias_shift > 0 else 0
        # Blend: 60% shifted + 40% base so bias doesn't fully dominate
        blended = 0.6 * shifted + 0.4 * base
        blended /= blended.sum()
        return int(rng.choice(CTAS_LEVELS, p=blended))
    return int(rng.choice(CTAS_LEVELS, p=base))


def _generate_din(rng: np.random.Generator) -> str:
    """Generate a realistic-looking 8-digit DIN starting with '02'."""
    suffix = "".join([str(rng.integers(0, 10)) for _ in range(6)])
    return f"02{suffix}"


# ---------------------------------------------------------------------------
# DATA GENERATION FUNCTIONS
# ---------------------------------------------------------------------------

def generate_patients(
    n: int,
    rng: np.random.Generator,
    fake: Faker,
) -> pd.DataFrame:
    """Generate synthetic patient records for Greater Victoria."""
    print(f"  Generating {n:,} patients...")

    # Age distribution: normal centred at 45, std 20, clipped 0-100
    ages = np.clip(rng.normal(45, 20, size=n), 0, 100).astype(int)
    today = datetime(2026, 3, 18)

    # Sex distribution: 51% F, 49% M
    sexes = rng.choice(["F", "M"], size=n, p=[0.51, 0.49])

    records: List[Dict[str, Any]] = []
    for i in range(n):
        age = int(ages[i])
        dob = today - timedelta(days=age * 365 + int(rng.integers(0, 365)))
        fsa = rng.choice(VICTORIA_FSAS)
        sex = sexes[i]

        if sex == "F":
            first = fake.first_name_female()
        else:
            first = fake.first_name_male()

        records.append({
            "patient_id": f"PAT-{i + 1:06d}",
            "first_name": first,
            "last_name": fake.last_name(),
            "date_of_birth": dob.strftime("%Y-%m-%d"),
            "age": age,
            "sex": sex,
            "postal_code": _make_postal_code(rng, fsa),
            "blood_type": rng.choice(BLOOD_TYPES, p=BLOOD_TYPE_WEIGHTS),
            "insurance_number": _make_msp_number(rng),
            "primary_language": rng.choice(LANGUAGES, p=LANGUAGE_WEIGHTS),
            "emergency_contact_phone": fake.phone_number(),
        })

    return pd.DataFrame(records)


def generate_physicians(n: int, fake: Faker) -> List[str]:
    """Generate a list of physician names."""
    return [f"Dr. {fake.first_name()} {fake.last_name()}" for _ in range(n)]


def generate_encounters(
    n: int,
    patient_ids: List[str],
    physicians: List[str],
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate synthetic encounter records with diagnosis correlation."""
    print(f"  Generating {n:,} encounters...")

    # Power-law patient distribution: some patients have many encounters
    num_patients = len(patient_ids)
    patient_weights = rng.pareto(a=1.5, size=num_patients)
    patient_weights /= patient_weights.sum()

    # Assign patients to encounters
    assigned_patients = rng.choice(patient_ids, size=n, p=patient_weights)

    # Date range: 2023-01-01 to 2026-03-15
    start_date = datetime(2023, 1, 1)
    end_date = datetime(2026, 3, 15)
    date_range_days = (end_date - start_date).days

    # Diagnosis weights
    diag_weights = np.array([d["weight"] for d in DIAGNOSES])
    diag_weights /= diag_weights.sum()

    records: List[Dict[str, Any]] = []
    for i in range(n):
        # Pick diagnosis
        diag_idx = int(rng.choice(len(DIAGNOSES), p=diag_weights))
        diag = DIAGNOSES[diag_idx]
        code = diag["code"]
        desc = diag["desc"]
        complaint = diag["complaint"]

        # Handle special categories
        if code == "INJURY":
            injury = INJURY_CODES[int(rng.integers(0, len(INJURY_CODES)))]
            code = injury[0]
            desc = injury[1]
            complaint = rng.choice(["injury from fall", "wound/laceration",
                                     "joint pain"])
        elif code == "OTHER":
            other = OTHER_CODES[int(rng.integers(0, len(OTHER_CODES)))]
            code = other[0]
            desc = other[1]
            complaint = rng.choice(OTHER_COMPLAINTS)

        # CTAS with diagnosis bias
        ctas = _biased_ctas(rng, diag["ctas_bias"][0])

        # Encounter type
        enc_type = rng.choice(ENCOUNTER_TYPES, p=ENCOUNTER_TYPE_WEIGHTS)

        # Disposition
        disposition = rng.choice(DISPOSITIONS, p=DISPOSITION_WEIGHTS)

        # Length of stay based on disposition
        if disposition == "discharged":
            los = 0.0
        elif disposition == "observation":
            los = round(float(rng.uniform(1, 72)), 1)
        elif disposition in ("admitted", "transferred"):
            los = round(float(rng.lognormal(mean=3.5, sigma=0.8)), 1)
            los = min(max(los, 24), 720)
        elif disposition == "deceased":
            los = round(float(rng.uniform(1, 500)), 1)
        else:  # left AMA
            los = round(float(rng.uniform(0, 24)), 1)

        enc_date = start_date + timedelta(days=int(rng.integers(0, date_range_days)))

        records.append({
            "encounter_id": f"ENC-{i + 1:07d}",
            "patient_id": assigned_patients[i],
            "encounter_date": enc_date.strftime("%Y-%m-%d"),
            "encounter_type": enc_type,
            "facility": rng.choice(FACILITIES, p=FACILITY_WEIGHTS),
            "chief_complaint": complaint,
            "diagnosis_code": code,
            "diagnosis_description": desc,
            "triage_level": ctas,
            "disposition": disposition,
            "length_of_stay_hours": los,
            "attending_physician": rng.choice(physicians),
        })

    return pd.DataFrame(records)


def generate_medications(
    n: int,
    patients_df: pd.DataFrame,
    encounters_df: pd.DataFrame,
    physicians: List[str],
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate medication records correlated with patient diagnoses."""
    print(f"  Generating {n:,} medication records...")

    # Build a patient -> diagnoses map from encounters
    patient_diagnoses: Dict[str, List[str]] = {}
    for _, row in encounters_df.iterrows():
        pid = row["patient_id"]
        dx = row["diagnosis_code"]
        if pid not in patient_diagnoses:
            patient_diagnoses[pid] = []
        patient_diagnoses[pid].append(dx)

    all_patient_ids = patients_df["patient_id"].tolist()
    drug_names = [d["name"] for d in DRUGS]

    start_date = datetime(2023, 1, 1)
    end_date = datetime(2026, 3, 15)
    date_range_days = (end_date - start_date).days

    records: List[Dict[str, Any]] = []
    for i in range(n):
        pid = rng.choice(all_patient_ids)
        dx_list = patient_diagnoses.get(pid, [])

        # Try to correlate drug with diagnosis
        drug_chosen = None
        if dx_list:
            # Check if any diagnosis has a mapped drug
            for dx in rng.permutation(dx_list):
                mapped_drugs = DIAGNOSIS_DRUG_MAP.get(dx, [])
                if mapped_drugs:
                    drug_name = rng.choice(mapped_drugs)
                    drug_chosen = next(
                        (d for d in DRUGS if d["name"] == drug_name), None
                    )
                    break

        # If no correlation found, pick a random drug
        if drug_chosen is None:
            drug_chosen = DRUGS[int(rng.integers(0, len(DRUGS)))]

        dosage = rng.choice(drug_chosen["dosages"])
        frequency = drug_chosen.get("freq", rng.choice(
            ["once daily", "twice daily", "three times daily", "as needed", "at bedtime"]
        ))
        route = drug_chosen.get("route", "oral")

        s_date = start_date + timedelta(days=int(rng.integers(0, date_range_days)))
        # 60% active (no end date)
        if rng.random() < 0.6:
            e_date = None
            active = True
        else:
            e_date = s_date + timedelta(days=int(rng.integers(7, 366)))
            active = False

        records.append({
            "medication_id": f"MED-{i + 1:06d}",
            "patient_id": pid,
            "drug_name": drug_chosen["name"],
            "drug_code": _generate_din(rng),
            "dosage": dosage,
            "frequency": frequency,
            "route": route,
            "prescriber": rng.choice(physicians),
            "start_date": s_date.strftime("%Y-%m-%d"),
            "end_date": e_date.strftime("%Y-%m-%d") if e_date else "",
            "active": active,
        })

    return pd.DataFrame(records)


def generate_lab_results(
    n: int,
    encounters_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate lab results correlated with encounter diagnoses."""
    print(f"  Generating {n:,} lab results...")

    # Build a map of encounter -> diagnosis for correlation
    enc_dx_map: Dict[str, str] = {}
    enc_date_map: Dict[str, str] = {}
    enc_pid_map: Dict[str, str] = {}
    for _, row in encounters_df.iterrows():
        eid = row["encounter_id"]
        enc_dx_map[eid] = row["diagnosis_code"]
        enc_date_map[eid] = row["encounter_date"]
        enc_pid_map[eid] = row["patient_id"]

    encounter_ids = encounters_df["encounter_id"].tolist()
    num_tests = len(LAB_TESTS_WITH_VALUES)

    records: List[Dict[str, Any]] = []
    for i in range(n):
        eid = rng.choice(encounter_ids)
        dx = enc_dx_map[eid]
        pid = enc_pid_map[eid]
        enc_date = enc_date_map[eid]

        # Pick a lab test
        test = LAB_TESTS_WITH_VALUES[int(rng.integers(0, num_tests))]
        ref_low = test["ref_low"]
        ref_high = test["ref_high"]

        # Generate value — normally within range, ~15% abnormal
        mid = (ref_low + ref_high) / 2.0
        spread = (ref_high - ref_low) / 2.0
        if rng.random() < 0.15:
            # Force abnormal: 50/50 high or low
            if rng.random() < 0.6:
                value = float(rng.uniform(ref_high * 1.01, ref_high * 1.5))
            else:
                value = float(rng.uniform(ref_low * 0.5, ref_low * 0.99))
        else:
            value = float(rng.normal(mid, spread * 0.3))

        # Apply diagnosis-specific correlations
        if dx == "E11.9" and test["loinc"] in ("1558-6", "4548-4"):
            # Diabetes → elevated glucose and HbA1c
            value = float(rng.uniform(ref_high * 1.1, ref_high * 2.0))
        elif dx == "I21.9" and test["loinc"] == "10839-9":
            # MI → elevated troponin
            value = float(rng.uniform(0.1, 5.0))
        elif dx == "I10" and test["loinc"] == "2951-2":
            # Hypertension — sodium might be slightly off
            if rng.random() < 0.3:
                value = float(rng.uniform(ref_high, ref_high + 5))
        elif dx == "J18.9" and test["loinc"] == "6690-2":
            # Pneumonia → elevated WBC
            if rng.random() < 0.7:
                value = float(rng.uniform(ref_high, ref_high * 2.0))

        # Ensure no negative values
        value = max(value, 0.0)

        # Determine abnormal flag
        if value < ref_low:
            flag = "L"
        elif value > ref_high:
            flag = "H"
        else:
            flag = "N"

        # Round appropriately
        if ref_high >= 100:
            value = round(value, 0)
        elif ref_high >= 10:
            value = round(value, 1)
        else:
            value = round(value, 2)

        # Collected date close to encounter date
        base_date = datetime.strptime(enc_date, "%Y-%m-%d")
        offset_days = int(rng.integers(0, 3))
        collected = base_date + timedelta(days=offset_days)

        records.append({
            "lab_id": f"LAB-{i + 1:06d}",
            "patient_id": pid,
            "encounter_id": eid,
            "test_name": test["name"],
            "test_code": test["loinc"],
            "value": value,
            "unit": test["unit"],
            "reference_range_low": ref_low,
            "reference_range_high": ref_high,
            "abnormal_flag": flag,
            "collected_date": collected.strftime("%Y-%m-%d"),
        })

    return pd.DataFrame(records)


def generate_vitals(
    n: int,
    encounters_df: pd.DataFrame,
    rng: np.random.Generator,
) -> pd.DataFrame:
    """Generate vital signs correlated with encounter diagnoses."""
    print(f"  Generating {n:,} vitals records...")

    enc_dx_map: Dict[str, str] = {}
    enc_date_map: Dict[str, str] = {}
    enc_pid_map: Dict[str, str] = {}
    for _, row in encounters_df.iterrows():
        eid = row["encounter_id"]
        enc_dx_map[eid] = row["diagnosis_code"]
        enc_date_map[eid] = row["encounter_date"]
        enc_pid_map[eid] = row["patient_id"]

    encounter_ids = encounters_df["encounter_id"].tolist()

    records: List[Dict[str, Any]] = []
    for i in range(n):
        eid = rng.choice(encounter_ids)
        dx = enc_dx_map[eid]
        pid = enc_pid_map[eid]
        enc_date = enc_date_map[eid]

        # Base vital signs
        hr = float(rng.normal(78, 12))
        systolic = float(rng.normal(120, 15))
        diastolic = float(rng.normal(75, 10))
        temp = float(rng.normal(36.7, 0.3))
        rr = float(rng.normal(16, 3))
        o2 = float(rng.normal(97.5, 1.5))
        pain = int(rng.choice(range(11), p=[
            0.25, 0.10, 0.10, 0.10, 0.10, 0.10, 0.08, 0.07, 0.05, 0.03, 0.02
        ]))

        # Apply diagnosis-specific correlations
        if dx == "I10":
            # Hypertension → elevated BP
            systolic = float(rng.normal(155, 15))
            diastolic = float(rng.normal(95, 10))
        elif dx == "I21.9":
            # MI → elevated HR, possibly low BP (cardiogenic shock in some)
            hr = float(rng.normal(100, 15))
            pain = int(rng.integers(7, 11))
            if rng.random() < 0.3:
                systolic = float(rng.normal(90, 10))
        elif dx in ("J45.9", "J18.9"):
            # Respiratory conditions → low O2, elevated RR
            o2 = float(rng.normal(92, 3))
            rr = float(rng.normal(22, 4))
        elif dx == "J06.9":
            # URI → mild fever possible
            if rng.random() < 0.4:
                temp = float(rng.normal(37.8, 0.4))
        elif dx in ("N39.0", "K35.9"):
            # Infections → fever
            temp = float(rng.normal(38.2, 0.5))
            hr = float(rng.normal(90, 10))
        elif dx.startswith("S"):
            # Injuries → elevated pain
            pain = int(rng.integers(4, 10))
            hr = float(rng.normal(85, 10))

        # Clip to realistic bounds
        hr = round(max(min(hr, 180), 40), 0)
        systolic = round(max(min(systolic, 250), 70), 0)
        diastolic = round(max(min(diastolic, 150), 40), 0)
        temp = round(max(min(temp, 41.0), 35.0), 1)
        rr = round(max(min(rr, 40), 8), 0)
        o2 = round(max(min(o2, 100), 70), 1)
        pain = max(min(pain, 10), 0)

        # Ensure diastolic < systolic
        if diastolic >= systolic:
            diastolic = systolic - 20

        # Recorded time
        base_date = datetime.strptime(enc_date, "%Y-%m-%d")
        hour = int(rng.integers(0, 24))
        minute = int(rng.integers(0, 60))
        recorded = base_date.replace(hour=hour, minute=minute)

        records.append({
            "vitals_id": f"VIT-{i + 1:06d}",
            "patient_id": pid,
            "encounter_id": eid,
            "heart_rate": int(hr),
            "systolic_bp": int(systolic),
            "diastolic_bp": int(diastolic),
            "temperature_celsius": temp,
            "respiratory_rate": int(rr),
            "o2_saturation": o2,
            "pain_scale": pain,
            "recorded_at": recorded.strftime("%Y-%m-%d %H:%M:%S"),
        })

    return pd.DataFrame(records)


def generate_bc_health_indicators(rng: np.random.Generator) -> pd.DataFrame:
    """Generate mock BC CHSA-level health indicators."""
    print("  Generating BC health indicators (78 CHSAs)...")

    rows: List[Dict[str, Any]] = []

    # Island Health CHSAs
    for chsa in ISLAND_HEALTH_CHSAS:
        rows.append(_make_chsa_row(rng, chsa["code"], chsa["name"], "Island Health"))

    # Other HA CHSAs
    for chsa in OTHER_HA_CHSAS:
        rows.append(_make_chsa_row(rng, chsa["code"], chsa["name"], chsa["ha"]))

    # Pad to 78 rows if needed (should already exceed 78 with 16 + 46 = 62;
    # we'll add a few more if under)
    while len(rows) < 78:
        idx = len(rows) + 1
        rows.append(_make_chsa_row(
            rng, f"99{idx:02d}", f"Additional CHSA {idx}", "Northern"
        ))

    return pd.DataFrame(rows[:78])


def _make_chsa_row(
    rng: np.random.Generator,
    code: str,
    name: str,
    ha: str,
) -> Dict[str, Any]:
    """Generate a single CHSA row with realistic BC health data."""
    # Population varies by area
    is_urban = name in (
        "Greater Victoria", "Saanich", "Vancouver Downtown", "Surrey",
        "Richmond", "Burnaby", "Kelowna", "Nanaimo", "Kamloops",
        "Prince George", "Vancouver Westside", "Vancouver Eastside",
        "Tri-Cities", "Langley",
    )

    if is_urban:
        pop = int(rng.integers(40000, 180000))
    else:
        pop = int(rng.integers(3000, 40000))

    median_age = round(float(rng.normal(43, 6)), 1)
    pct_over_65 = round(float(rng.normal(20, 5)), 1)
    pct_under_18 = round(float(rng.normal(18, 4)), 1)

    # Northern / rural areas tend to have worse health outcomes
    is_northern = ha == "Northern"
    outcome_penalty = 1.15 if is_northern else 1.0
    income_penalty = 0.85 if is_northern else 1.0

    return {
        "chsa_code": code,
        "chsa_name": name,
        "health_authority": ha,
        "population": pop,
        "median_age": max(median_age, 25),
        "pct_over_65": max(min(pct_over_65, 40), 8),
        "pct_under_18": max(min(pct_under_18, 30), 10),
        "life_expectancy": round(float(rng.normal(82, 2)) / outcome_penalty, 1),
        "infant_mortality_rate": round(
            float(rng.uniform(3.0, 7.0)) * outcome_penalty, 1
        ),
        "pct_obese": round(float(rng.normal(27, 5)) * outcome_penalty, 1),
        "pct_smokers": round(float(rng.normal(14, 4)) * outcome_penalty, 1),
        "pct_heavy_drinkers": round(float(rng.normal(18, 4)) * outcome_penalty, 1),
        "diabetes_prevalence": round(float(rng.normal(8.5, 2)) * outcome_penalty, 1),
        "hypertension_prevalence": round(
            float(rng.normal(23, 4)) * outcome_penalty, 1
        ),
        "mental_health_hospitalization_rate": round(
            float(rng.normal(500, 100)) * outcome_penalty, 0
        ),
        "opioid_overdose_rate": round(
            float(rng.uniform(15, 45)) * outcome_penalty, 1
        ),
        "median_household_income": int(
            rng.normal(72000, 15000) * income_penalty
        ),
        "pct_below_poverty_line": round(
            float(rng.normal(12, 4)) / income_penalty, 1
        ),
        "pct_without_family_doctor": round(float(rng.normal(18, 6)), 1),
        "hospital_beds_per_1000": round(float(rng.uniform(1.5, 4.5)), 1),
        "er_visits_per_1000": round(
            float(rng.normal(350, 80)) * outcome_penalty, 0
        ),
    }


def generate_wait_times(rng: np.random.Generator) -> pd.DataFrame:
    """Generate mock CIHI-style wait times data (2014-2025)."""
    print("  Generating CIHI wait times data...")

    rows: List[Dict[str, Any]] = []
    years = list(range(2014, 2026))

    for proc_info in WAIT_TIME_PROCEDURES:
        proc = proc_info["procedure"]
        benchmark = proc_info["benchmark"]
        base_median = proc_info["base_median"]
        base_volume = proc_info["base_volume"]

        for year in years:
            for province in PROVINCES:
                # Provincial variation factor
                prov_factor = {
                    "BC": 1.0, "AB": 0.9, "SK": 1.1, "MB": 1.15,
                    "ON": 0.95, "QC": 1.05, "NB": 1.2, "NS": 1.15,
                    "PE": 1.25, "NL": 1.3,
                }.get(province, 1.0)

                # Year trend: slight improvement 2014-2019, COVID spike 2020-21,
                # recovery 2022-2025
                if year <= 2019:
                    year_factor = 1.0 - (year - 2014) * 0.01
                elif year == 2020:
                    year_factor = 1.35
                elif year == 2021:
                    year_factor = 1.25
                elif year == 2022:
                    year_factor = 1.15
                elif year == 2023:
                    year_factor = 1.08
                elif year == 2024:
                    year_factor = 1.03
                else:
                    year_factor = 1.0

                median_wait = round(
                    base_median * prov_factor * year_factor
                    + float(rng.normal(0, base_median * 0.1)),
                    0,
                )
                median_wait = max(median_wait, 1)

                # Percentage within benchmark
                if median_wait <= benchmark:
                    pct_bench = round(
                        float(rng.uniform(70, 95)) - (median_wait / benchmark) * 10,
                        0,
                    )
                else:
                    pct_bench = round(float(rng.uniform(40, 70)), 0)
                pct_bench = max(min(pct_bench, 99), 20)

                # Volume with COVID dip
                vol_factor = 0.6 if year == 2020 else (0.8 if year == 2021 else 1.0)
                volume = int(
                    base_volume / len(PROVINCES) * prov_factor * vol_factor
                    + rng.normal(0, base_volume * 0.02)
                )
                volume = max(volume, 50)

                rows.append({
                    "year": year,
                    "province": province,
                    "procedure": proc,
                    "median_wait_days": int(median_wait),
                    "pct_within_benchmark": int(pct_bench),
                    "benchmark_days": benchmark,
                    "volume": volume,
                })

    return pd.DataFrame(rows)


def generate_opioid_data(rng: np.random.Generator) -> pd.DataFrame:
    """Generate mock PHAC-style opioid surveillance data (2016-2025)."""
    print("  Generating opioid surveillance data...")

    rows: List[Dict[str, Any]] = []

    for year in range(2016, 2026):
        for quarter in range(1, 5):
            for province in PROVINCES:
                # BC has the highest rates
                prov_factor = {
                    "BC": 1.8, "AB": 1.3, "SK": 0.9, "MB": 0.8,
                    "ON": 1.1, "QC": 0.7, "NB": 0.6, "NS": 0.7,
                    "PE": 0.5, "NL": 0.6,
                }.get(province, 1.0)

                # Crisis trajectory: rising 2016-2019, spike 2020-21, slight
                # decline then plateau
                if year == 2016:
                    year_factor = 0.6
                elif year == 2017:
                    year_factor = 0.8
                elif year == 2018:
                    year_factor = 0.9
                elif year == 2019:
                    year_factor = 1.0
                elif year == 2020:
                    year_factor = 1.5
                elif year == 2021:
                    year_factor = 1.7
                elif year == 2022:
                    year_factor = 1.4
                elif year == 2023:
                    year_factor = 1.3
                elif year == 2024:
                    year_factor = 1.25
                else:
                    year_factor = 1.2

                # Province population scaling (rough)
                pop_scale = {
                    "BC": 5.3, "AB": 4.6, "SK": 1.2, "MB": 1.4,
                    "ON": 15.0, "QC": 8.6, "NB": 0.8, "NS": 1.0,
                    "PE": 0.17, "NL": 0.53,
                }.get(province, 1.0)

                base_deaths = 50 * prov_factor * year_factor * (pop_scale / 5.0)
                deaths = int(max(
                    base_deaths + rng.normal(0, base_deaths * 0.15), 0
                ))

                base_hosp = deaths * 1.8
                hospitalizations = int(max(
                    base_hosp + rng.normal(0, base_hosp * 0.1), 0
                ))

                base_ed = deaths * 4.5
                ed_visits = int(max(
                    base_ed + rng.normal(0, base_ed * 0.1), 0
                ))

                rate_deaths = round(
                    deaths / (pop_scale * 1e6) * 1e5 * 4, 1
                )  # annualized
                rate_hosp = round(
                    hospitalizations / (pop_scale * 1e6) * 1e5 * 4, 1
                )

                rows.append({
                    "year": year,
                    "quarter": f"Q{quarter}",
                    "province": province,
                    "apparent_opioid_toxicity_deaths": deaths,
                    "opioid_hospitalizations": hospitalizations,
                    "opioid_ed_visits": ed_visits,
                    "rate_per_100k_deaths": max(rate_deaths, 0),
                    "rate_per_100k_hospitalizations": max(rate_hosp, 0),
                })

    return pd.DataFrame(rows)


def generate_drug_reference(rng: np.random.Generator) -> pd.DataFrame:
    """Generate a 100-row Canadian drug reference database."""
    print("  Generating drug reference database (100 entries)...")

    rows: List[Dict[str, Any]] = []

    # Core 25 drugs
    drug_class_map = {
        "metformin": ("Biguanide", "Type 2 diabetes", "Prescription"),
        "lisinopril": ("ACE inhibitor", "Hypertension", "Prescription"),
        "atorvastatin": ("Statin", "Hyperlipidemia", "Prescription"),
        "levothyroxine": ("Thyroid hormone", "Hypothyroidism", "Prescription"),
        "amlodipine": ("Calcium channel blocker", "Hypertension", "Prescription"),
        "omeprazole": ("Proton pump inhibitor", "GERD", "OTC"),
        "salbutamol": ("Short-acting beta-agonist", "Asthma", "Prescription"),
        "rosuvastatin": ("Statin", "Hyperlipidemia", "Prescription"),
        "ramipril": ("ACE inhibitor", "Hypertension", "Prescription"),
        "pantoprazole": ("Proton pump inhibitor", "GERD", "Prescription"),
        "metoprolol": ("Beta blocker", "Hypertension", "Prescription"),
        "hydrochlorothiazide": ("Thiazide diuretic", "Hypertension", "Prescription"),
        "sertraline": ("SSRI antidepressant", "Depression", "Prescription"),
        "escitalopram": ("SSRI antidepressant", "Depression, anxiety", "Prescription"),
        "gabapentin": ("Anticonvulsant", "Neuropathic pain, epilepsy", "Prescription"),
        "amoxicillin": ("Penicillin antibiotic", "Bacterial infections", "Prescription"),
        "azithromycin": ("Macrolide antibiotic", "Bacterial infections", "Prescription"),
        "prednisone": ("Corticosteroid", "Inflammation", "Prescription"),
        "acetaminophen": ("Analgesic/antipyretic", "Pain, fever", "OTC"),
        "ibuprofen": ("NSAID", "Pain, inflammation", "OTC"),
        "warfarin": ("Vitamin K antagonist", "Anticoagulation", "Prescription"),
        "insulin glargine": ("Long-acting insulin", "Diabetes", "Prescription"),
        "sitagliptin": ("DPP-4 inhibitor", "Type 2 diabetes", "Prescription"),
        "clopidogrel": ("Antiplatelet", "Cardiovascular prevention", "Prescription"),
        "furosemide": ("Loop diuretic", "Edema, heart failure", "Prescription"),
    }

    for drug_info in DRUGS:
        name = drug_info["name"]
        cls, indication, schedule = drug_class_map.get(
            name, ("Unknown", "Unknown", "Prescription")
        )
        rows.append({
            "din": _generate_din(rng),
            "drug_name": name,
            "generic_name": name,
            "drug_class": cls,
            "common_indication": indication,
            "typical_dosage": drug_info["dosages"][0],
            "route": drug_info.get("route", "oral"),
            "schedule": schedule,
        })

    # Additional 75 drugs
    for extra in ADDITIONAL_DRUGS:
        rows.append({
            "din": _generate_din(rng),
            "drug_name": extra["name"],
            "generic_name": extra["generic"],
            "drug_class": extra["class"],
            "common_indication": extra["indication"],
            "typical_dosage": extra["dosage"],
            "route": extra["route"],
            "schedule": extra["schedule"],
        })

    return pd.DataFrame(rows[:100])


def generate_fhir_patient() -> Dict[str, Any]:
    """Generate a sample FHIR R4 Patient resource (Canadian)."""
    return {
        "resourceType": "Patient",
        "id": "example-canadian-patient",
        "meta": {
            "profile": [
                "http://hl7.org/fhir/ca/core/StructureDefinition/profile-patient"
            ]
        },
        "identifier": [
            {
                "use": "official",
                "type": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                            "code": "JHN",
                            "display": "Jurisdictional health number"
                        }
                    ]
                },
                "system": "https://fhir.infoway-inforoute.ca/NamingSystem/ca-bc-patient-hcn",
                "value": "9876543210"
            }
        ],
        "active": True,
        "name": [
            {
                "use": "official",
                "family": "Tremblay",
                "given": ["Marie", "Claire"]
            }
        ],
        "telecom": [
            {
                "system": "phone",
                "value": "+1-250-555-0142",
                "use": "home"
            },
            {
                "system": "email",
                "value": "marie.tremblay@example.ca",
                "use": "home"
            }
        ],
        "gender": "female",
        "birthDate": "1985-07-23",
        "address": [
            {
                "use": "home",
                "type": "physical",
                "line": ["1234 Oak Bay Avenue"],
                "city": "Victoria",
                "state": "BC",
                "postalCode": "V8R 1G3",
                "country": "CA"
            }
        ],
        "maritalStatus": {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/v3-MaritalStatus",
                    "code": "M",
                    "display": "Married"
                }
            ]
        },
        "communication": [
            {
                "language": {
                    "coding": [
                        {
                            "system": "urn:ietf:bcp:47",
                            "code": "en",
                            "display": "English"
                        }
                    ]
                },
                "preferred": True
            },
            {
                "language": {
                    "coding": [
                        {
                            "system": "urn:ietf:bcp:47",
                            "code": "fr",
                            "display": "French"
                        }
                    ]
                },
                "preferred": False
            }
        ],
        "generalPractitioner": [
            {
                "reference": "Practitioner/dr-smith-victoria",
                "display": "Dr. Sarah Smith"
            }
        ],
        "managingOrganization": {
            "reference": "Organization/island-health",
            "display": "Island Health Authority"
        }
    }


def generate_fhir_encounter() -> Dict[str, Any]:
    """Generate a sample FHIR R4 Encounter resource."""
    return {
        "resourceType": "Encounter",
        "id": "example-emergency-encounter",
        "meta": {
            "profile": [
                "http://hl7.org/fhir/ca/core/StructureDefinition/profile-encounter"
            ]
        },
        "identifier": [
            {
                "use": "official",
                "system": "https://fhir.viha.ca/encounter-id",
                "value": "ENC-0000001"
            }
        ],
        "status": "finished",
        "class": {
            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            "code": "EMER",
            "display": "emergency"
        },
        "type": [
            {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "50849002",
                        "display": "Emergency department patient visit"
                    }
                ]
            }
        ],
        "subject": {
            "reference": "Patient/example-canadian-patient",
            "display": "Marie Claire Tremblay"
        },
        "participant": [
            {
                "type": [
                    {
                        "coding": [
                            {
                                "system": "http://terminology.hl7.org/CodeSystem/v3-ParticipationType",
                                "code": "ATND",
                                "display": "attender"
                            }
                        ]
                    }
                ],
                "individual": {
                    "reference": "Practitioner/dr-chen-jubilee",
                    "display": "Dr. Wei Chen"
                }
            }
        ],
        "period": {
            "start": "2025-11-15T08:30:00-08:00",
            "end": "2025-11-15T14:45:00-08:00"
        },
        "reasonCode": [
            {
                "coding": [
                    {
                        "system": "http://snomed.info/sct",
                        "code": "29857009",
                        "display": "Chest pain"
                    }
                ]
            }
        ],
        "diagnosis": [
            {
                "condition": {
                    "reference": "Condition/example-mi",
                    "display": "Acute myocardial infarction"
                },
                "use": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/diagnosis-role",
                            "code": "AD",
                            "display": "Admission diagnosis"
                        }
                    ]
                }
            }
        ],
        "hospitalization": {
            "dischargeDisposition": {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/discharge-disposition",
                        "code": "home",
                        "display": "Home"
                    }
                ]
            }
        },
        "location": [
            {
                "location": {
                    "reference": "Location/rjh-emergency",
                    "display": "Royal Jubilee Hospital - Emergency Department"
                },
                "status": "completed"
            }
        ],
        "serviceProvider": {
            "reference": "Organization/island-health",
            "display": "Island Health Authority"
        }
    }


def generate_fhir_observation() -> Dict[str, Any]:
    """Generate a sample FHIR R4 Observation resource (lab result)."""
    return {
        "resourceType": "Observation",
        "id": "example-troponin-result",
        "meta": {
            "profile": [
                "http://hl7.org/fhir/ca/core/StructureDefinition/profile-observation"
            ]
        },
        "identifier": [
            {
                "use": "official",
                "system": "https://fhir.viha.ca/lab-id",
                "value": "LAB-000001"
            }
        ],
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "laboratory",
                        "display": "Laboratory"
                    }
                ]
            }
        ],
        "code": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": "10839-9",
                    "display": "Troponin I [Mass/volume] in Serum or Plasma"
                }
            ],
            "text": "Troponin I"
        },
        "subject": {
            "reference": "Patient/example-canadian-patient",
            "display": "Marie Claire Tremblay"
        },
        "encounter": {
            "reference": "Encounter/example-emergency-encounter"
        },
        "effectiveDateTime": "2025-11-15T09:15:00-08:00",
        "issued": "2025-11-15T10:30:00-08:00",
        "performer": [
            {
                "reference": "Organization/rjh-lab",
                "display": "Royal Jubilee Hospital Laboratory"
            }
        ],
        "valueQuantity": {
            "value": 2.45,
            "unit": "ng/mL",
            "system": "http://unitsofmeasure.org",
            "code": "ng/mL"
        },
        "interpretation": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                        "code": "H",
                        "display": "High"
                    }
                ]
            }
        ],
        "referenceRange": [
            {
                "low": {
                    "value": 0.0,
                    "unit": "ng/mL",
                    "system": "http://unitsofmeasure.org"
                },
                "high": {
                    "value": 0.04,
                    "unit": "ng/mL",
                    "system": "http://unitsofmeasure.org"
                },
                "text": "0.00 - 0.04 ng/mL"
            }
        ],
        "note": [
            {
                "text": "Elevated troponin consistent with acute myocardial injury. "
                        "Recommend serial monitoring and cardiology consultation."
            }
        ]
    }


# ---------------------------------------------------------------------------
# DOWNLOAD HELPER FUNCTIONS
# ---------------------------------------------------------------------------

def download_statcan_table(table_id: str, output_dir: str) -> bool:
    """Download a Statistics Canada table as CSV.

    Args:
        table_id: StatCan table ID (e.g. '13-10-0905-01').
        output_dir: Directory to save the downloaded CSV.

    Returns:
        True if download succeeded, False otherwise.
    """
    try:
        import requests as req

        # Convert table ID format: "13-10-0905-01" → "13100905"
        numeric_id = table_id.replace("-", "")[:8]
        url = f"https://www150.statcan.gc.ca/n1/tbl/csv/{numeric_id}-eng.zip"

        print(f"  Attempting to download StatCan table {table_id}...")
        print(f"  URL: {url}")

        resp = req.get(url, timeout=30)
        resp.raise_for_status()

        os.makedirs(output_dir, exist_ok=True)
        zip_path = os.path.join(output_dir, f"{numeric_id}-eng.zip")
        with open(zip_path, "wb") as f:
            f.write(resp.content)

        # Unzip
        with zipfile.ZipFile(zip_path, "r") as zf:
            zf.extractall(output_dir)

        os.remove(zip_path)
        print(f"  Successfully downloaded and extracted StatCan table {table_id}")
        return True

    except Exception as e:
        print(f"  Failed to download StatCan table {table_id}: {e}")
        print("  Will use mock data instead.")
        return False


def download_phac_opioid_data(output_dir: str) -> bool:
    """Try to download PHAC opioid surveillance data from open.canada.ca.

    Args:
        output_dir: Directory to save the downloaded data.

    Returns:
        True if download succeeded, False otherwise.
    """
    try:
        import requests as req

        print("  Attempting to download PHAC opioid data from open.canada.ca...")
        url = (
            "https://health-infobase.canada.ca/src/data/substance-related-harms/"
            "opioid-data-table.csv"
        )
        resp = req.get(url, timeout=30)
        resp.raise_for_status()

        os.makedirs(output_dir, exist_ok=True)
        out_path = os.path.join(output_dir, "phac_opioid_data_real.csv")
        with open(out_path, "wb") as f:
            f.write(resp.content)

        print(f"  Successfully downloaded PHAC opioid data to {out_path}")
        return True

    except Exception as e:
        print(f"  Failed to download PHAC opioid data: {e}")
        print("  Will use mock data instead.")
        return False


def download_bc_community_data(output_dir: str) -> bool:
    """Try to download BC CHSA community profile data.

    Args:
        output_dir: Directory to save the downloaded data.

    Returns:
        True if download succeeded, False otherwise.
    """
    try:
        import requests as req

        print("  Attempting to download BC community health data...")
        url = (
            "http://www.movingtobc.ca/sites/default/files/"
            "bc-community-health-profiles.csv"
        )
        resp = req.get(url, timeout=30)
        resp.raise_for_status()

        os.makedirs(output_dir, exist_ok=True)
        out_path = os.path.join(output_dir, "bc_community_data_real.csv")
        with open(out_path, "wb") as f:
            f.write(resp.content)

        print(f"  Successfully downloaded BC community data to {out_path}")
        return True

    except Exception as e:
        print(f"  Failed to download BC community data: {e}")
        print("  Will use mock data instead.")
        return False


# ---------------------------------------------------------------------------
# MAIN
# ---------------------------------------------------------------------------

def main() -> None:
    """Run the full data generation pipeline."""
    parser = argparse.ArgumentParser(
        description="UVic Healthcare AI Hackathon — Data Setup Tool",
    )
    parser.add_argument(
        "--offline",
        action="store_true",
        help="Skip all download attempts and use only generated/mock data.",
    )
    parser.add_argument(
        "--output-dir",
        default="hackathon-data",
        help="Root output directory (default: hackathon-data).",
    )
    args = parser.parse_args()

    print()
    print("=" * 65)
    print("  \U0001f3e5 UVic Healthcare AI Hackathon - Data Setup Tool")
    print("  University of Victoria, BC, Canada")
    print("  March 27-28, 2026")
    print("=" * 65)
    print()

    root = Path(args.output_dir)

    # Initialize RNG and Faker
    rng = np.random.default_rng(RANDOM_SEED)
    fake = Faker("en_CA")
    Faker.seed(RANDOM_SEED)

    # ------------------------------------------------------------------
    # 1. Create folder structure
    # ------------------------------------------------------------------
    print("[1/7] Creating folder structure...")
    dirs = [
        root / "track-1-clinical-ai" / "synthea-patients",
        root / "track-1-clinical-ai" / "canadian-health-stats",
        root / "track-2-population-health" / "bc-community-profiles",
        root / "track-2-population-health" / "cihi-wait-times",
        root / "track-2-population-health" / "opioid-surveillance",
        root / "shared" / "drug-database",
        root / "shared" / "fhir-examples",
    ]
    for d in dirs:
        d.mkdir(parents=True, exist_ok=True)
    print("  Folder structure created.\n")

    # Placeholders
    for placeholder in [
        root / "track-1-clinical-ai" / "starter-notebook.ipynb",
        root / "track-2-population-health" / "starter-notebook.ipynb",
    ]:
        if not placeholder.exists():
            placeholder.write_text(json.dumps({
                "cells": [],
                "metadata": {
                    "kernelspec": {
                        "display_name": "Python 3",
                        "language": "python",
                        "name": "python3"
                    },
                    "language_info": {"name": "python", "version": "3.10.0"}
                },
                "nbformat": 4,
                "nbformat_minor": 5
            }, indent=2))

    (root / "shared" / "utilities.py").write_text(
        "# See /home/user/workspace/hackathon-data-kit/shared/utilities.py"
        " for the full version\n"
    )
    (root / "README.md").write_text(
        "# UVic Healthcare AI Hackathon Data Kit\n\n"
        "Placeholder — see hackathon_data_setup.py for generation details.\n"
    )

    # ------------------------------------------------------------------
    # 2. Generate synthetic clinical data (Track 1)
    # ------------------------------------------------------------------
    print("[2/7] Generating synthetic clinical data (Track 1)...")
    clinical_dir = root / "track-1-clinical-ai" / "synthea-patients"

    patients_df = generate_patients(2000, rng, fake)
    patients_df.to_csv(clinical_dir / "patients.csv", index=False)

    physicians = generate_physicians(50, fake)

    encounters_df = generate_encounters(10000, patients_df["patient_id"].tolist(),
                                         physicians, rng)
    encounters_df.to_csv(clinical_dir / "encounters.csv", index=False)

    medications_df = generate_medications(5000, patients_df, encounters_df,
                                           physicians, rng)
    medications_df.to_csv(clinical_dir / "medications.csv", index=False)

    lab_results_df = generate_lab_results(3000, encounters_df, rng)
    lab_results_df.to_csv(clinical_dir / "lab_results.csv", index=False)

    vitals_df = generate_vitals(2000, encounters_df, rng)
    vitals_df.to_csv(clinical_dir / "vitals.csv", index=False)
    print()

    # ------------------------------------------------------------------
    # 3. Generate population health mock data (Track 2)
    # ------------------------------------------------------------------
    print("[3/7] Generating population health data (Track 2)...")
    bc_dir = root / "track-2-population-health" / "bc-community-profiles"
    bc_health_df = generate_bc_health_indicators(rng)
    bc_health_df.to_csv(bc_dir / "bc_health_indicators.csv", index=False)

    wait_dir = root / "track-2-population-health" / "cihi-wait-times"
    wait_df = generate_wait_times(rng)
    wait_df.to_csv(wait_dir / "wait_times_mock.csv", index=False)

    # Download instructions
    instructions = (
        "CIHI Wait Times Data — Download Instructions\n"
        "=" * 50 + "\n\n"
        "To get real CIHI wait times data (Excel format):\n\n"
        "1. Go to: https://www.cihi.ca/en/topics/access-and-wait-times/data-tables\n"
        "2. Select the procedure of interest (e.g., Hip Replacement, Knee Replacement)\n"
        "3. Choose the data table format (XLSX)\n"
        "4. Download and save to this directory\n\n"
        "Available tables include:\n"
        "  - Wait Times for Hip and Knee Replacements\n"
        "  - Wait Times for Cataract Surgery\n"
        "  - Wait Times for Radiation Therapy\n"
        "  - Wait Times for Hip Fracture Repair\n"
        "  - Wait Times for Diagnostic Imaging (CT, MRI)\n"
        "  - Wait Times for Cardiac Bypass Surgery\n\n"
        "Note: CIHI data requires free registration. The mock data in\n"
        "wait_times_mock.csv mirrors the structure and realistic trends.\n"
    )
    (wait_dir / "download_instructions.txt").write_text(instructions)

    opioid_dir = root / "track-2-population-health" / "opioid-surveillance"
    opioid_df = generate_opioid_data(rng)
    opioid_df.to_csv(opioid_dir / "opioid_harms_mock.csv", index=False)
    print()

    # ------------------------------------------------------------------
    # 4. Generate shared resources
    # ------------------------------------------------------------------
    print("[4/7] Generating shared resources...")
    drug_dir = root / "shared" / "drug-database"
    drug_ref_df = generate_drug_reference(rng)
    drug_ref_df.to_csv(drug_dir / "canadian_drug_reference.csv", index=False)

    fhir_dir = root / "shared" / "fhir-examples"
    with open(fhir_dir / "sample_patient.json", "w") as f:
        json.dump(generate_fhir_patient(), f, indent=2)
    with open(fhir_dir / "sample_encounter.json", "w") as f:
        json.dump(generate_fhir_encounter(), f, indent=2)
    with open(fhir_dir / "sample_observation.json", "w") as f:
        json.dump(generate_fhir_observation(), f, indent=2)
    print("  FHIR R4 sample resources generated.\n")

    # ------------------------------------------------------------------
    # 5. Attempt real data downloads (unless --offline)
    # ------------------------------------------------------------------
    if not args.offline:
        print("[5/7] Attempting real data downloads...")
        stats_dir = root / "track-1-clinical-ai" / "canadian-health-stats"
        download_statcan_table("13-10-0905-01", str(stats_dir))
        download_phac_opioid_data(str(opioid_dir))
        download_bc_community_data(str(bc_dir))
        print()
    else:
        print("[5/7] Skipping downloads (--offline mode).\n")

    # ------------------------------------------------------------------
    # 6. Summary
    # ------------------------------------------------------------------
    print("[6/7] Generation complete! Summary:")
    print("-" * 50)

    total_bytes = 0
    file_summary: List[Tuple[str, int]] = []

    for dirpath, _dirnames, filenames in os.walk(root):
        for fn in filenames:
            fp = os.path.join(dirpath, fn)
            size = os.path.getsize(fp)
            total_bytes += size
            rel = os.path.relpath(fp, root)
            file_summary.append((rel, size))

    file_summary.sort(key=lambda x: -x[1])
    for rel_path, size in file_summary:
        if size >= 1024 * 1024:
            size_str = f"{size / (1024 * 1024):.1f} MB"
        elif size >= 1024:
            size_str = f"{size / 1024:.1f} KB"
        else:
            size_str = f"{size} B"
        print(f"  {rel_path:<60s} {size_str:>10s}")

    print("-" * 50)
    if total_bytes >= 1024 * 1024:
        total_str = f"{total_bytes / (1024 * 1024):.1f} MB"
    else:
        total_str = f"{total_bytes / 1024:.1f} KB"
    print(f"  {'Total:':60s} {total_str:>10s}")
    print()

    # ------------------------------------------------------------------
    # 7. Done
    # ------------------------------------------------------------------
    print("[7/7] Data kit ready!")
    print()
    print(f"  Output directory: {root.resolve()}")
    print()
    print("  Track 1 (Clinical AI):")
    print(f"    - {len(patients_df):,} patients")
    print(f"    - {len(encounters_df):,} encounters")
    print(f"    - {len(medications_df):,} medication records")
    print(f"    - {len(lab_results_df):,} lab results")
    print(f"    - {len(vitals_df):,} vitals records")
    print()
    print("  Track 2 (Population Health):")
    print(f"    - {len(bc_health_df)} BC CHSA health indicators")
    print(f"    - {len(wait_df):,} CIHI wait time data points")
    print(f"    - {len(opioid_df):,} opioid surveillance data points")
    print()
    print("  Shared Resources:")
    print(f"    - {len(drug_ref_df)} drug reference entries")
    print("    - 3 FHIR R4 sample resources")
    print()
    print("  Happy hacking! \U0001f680")
    print()


if __name__ == "__main__":
    main()
