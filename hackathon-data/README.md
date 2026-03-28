# 🏥 UVic Healthcare AI Hackathon — Data Starter Kit
## March 27-28, 2026 | University of Victoria, BC

Welcome to the data starter kit! Everything you need to start building is here — synthetic clinical data, population health datasets, starter notebooks, and utility functions.

> ⚠️ **All data in this kit is synthetic.** No real patient data is included. This data was generated to mimic patterns in BC healthcare for educational purposes only.

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
pip install -r requirements.txt

# 2. Generate the data (takes ~30 seconds)
python hackathon_data_setup.py

# 3. Open a starter notebook
jupyter notebook track-1-clinical-ai/starter-notebook.ipynb
# or
jupyter notebook track-2-population-health/starter-notebook.ipynb
```

### Offline Mode
If WiFi is slow, run with the --offline flag to skip downloading real datasets (synthetic data + mock population data will still be generated):
```bash
python hackathon_data_setup.py --offline
```

---

## 📁 Folder Structure

```
hackathon-data/
├── track-1-clinical-ai/           # Clinical AI track
│   ├── synthea-patients/
│   │   ├── patients.csv           (2,000 synthetic patients)
│   │   ├── encounters.csv         (10,000 clinical encounters)
│   │   ├── medications.csv        (5,000 medication records)
│   │   ├── lab_results.csv        (3,000 lab test results)
│   │   └── vitals.csv             (2,000 vital sign readings)
│   ├── canadian-health-stats/     (Statistics Canada data, if downloaded)
│   └── starter-notebook.ipynb     (EDA + triage prediction model)
│
├── track-2-population-health/     # Population Health track
│   ├── bc-community-profiles/
│   │   └── bc_health_indicators.csv  (78 BC communities)
│   ├── cihi-wait-times/
│   │   ├── wait_times_mock.csv    (surgical wait times 2014-2025)
│   │   └── download_instructions.txt
│   ├── opioid-surveillance/
│   │   └── opioid_harms_mock.csv  (opioid crisis data 2016-2025)
│   └── starter-notebook.ipynb     (SDOH analysis + wait time forecast)
│
├── shared/                        # Shared resources
│   ├── drug-database/
│   │   └── canadian_drug_reference.csv  (100 common Canadian drugs)
│   ├── fhir-examples/
│   │   ├── sample_patient.json    (FHIR R4 Patient resource)
│   │   ├── sample_encounter.json  (FHIR R4 Encounter resource)
│   │   └── sample_observation.json (FHIR R4 Observation resource)
│   └── utilities.py               (data loading & analysis helpers)
│
├── hackathon_data_setup.py        # Data generation script
├── requirements.txt               # Python dependencies
└── README.md                      # This file
```

---

## 📊 Datasets

### Track 1: Clinical AI — Synthetic EHR Data

| File | Records | Description |
|------|---------|-------------|
| `patients.csv` | 2,000 | Synthetic BC patients with demographics (age, sex, postal code, blood type, MSP number) |
| `encounters.csv` | 10,000 | Clinical encounters across 5 Victoria-area hospitals with ICD-10-CA diagnoses and CTAS triage levels |
| `medications.csv` | 5,000 | Prescription records with Canadian DIN drug codes, dosages, and frequencies |
| `lab_results.csv` | 3,000 | Lab tests with LOINC codes, values, units, and reference ranges |
| `vitals.csv` | 2,000 | Vital signs (HR, BP, temp, O2 sat, respiratory rate, pain scale) |

**Key feature:** The data is medically coherent — diabetic patients have elevated glucose, hypertensive patients have high BP, MI patients have elevated troponin. This makes it realistic for ML model training.

**Facilities modeled:** Royal Jubilee Hospital, Victoria General Hospital, Saanich Peninsula Hospital, Cowichan District Hospital, Nanaimo Regional General Hospital

### Track 2: Population Health Data

| File | Records | Description |
|------|---------|-------------|
| `bc_health_indicators.csv` | 78 | Community-level health indicators for BC CHSAs (demographics, chronic disease, SDOH) |
| `wait_times_mock.csv` | ~960 | CIHI-style surgical wait times by province and procedure (2014-2025) |
| `opioid_harms_mock.csv` | ~400 | PHAC-style opioid surveillance data (deaths, hospitalizations, ED visits by province, 2016-2025) |

### Shared Resources

| File | Description |
|------|-------------|
| `canadian_drug_reference.csv` | 100 common Canadian prescription drugs with DIN, class, indication, dosage |
| `sample_patient.json` | Example FHIR R4 Patient resource (Canadian) |
| `sample_encounter.json` | Example FHIR R4 Encounter resource |
| `sample_observation.json` | Example FHIR R4 Observation (lab result) |
| `utilities.py` | Helper functions for loading, merging, and analyzing data |

---

## 🔧 Using the Utilities

```python
import sys
sys.path.insert(0, "shared")  # or "../shared" from a track folder
from utilities import *

# Load data
patients = load_patients()
encounters = load_encounters()

# Merge patients with their encounters
patient_encounters = merge_patient_encounters()

# Find high-risk patients (3+ conditions or 5+ active meds)
high_risk = get_high_risk_patients()

# Calculate 30-day readmission rate
readmissions = calculate_readmission_rate()

# Convert to FHIR format
fhir_patient = patient_to_fhir(patients.iloc[0])

# Get a quick overview of all datasets
dataset_overview()
```

---

## 🏁 Challenge Tracks

### Track 1: Clinical AI Assistant
Build an AI-powered tool that helps clinicians triage patients, predict outcomes, or support clinical decision-making.

**Starter project in the notebook:** Predict CTAS triage level from chief complaint + vital signs using a Random Forest classifier.

**Ideas to extend:**
- NLP-based chief complaint analysis
- Medication interaction checker
- Early warning system for patient deterioration
- ED wait time predictor
- FHIR-native clinical dashboard

### Track 2: Population Health & Health Equity
Build a data-driven tool that reveals health disparities, predicts population health trends, or optimizes resource allocation.

**Starter project in the notebook:** Forecast BC surgical wait times using polynomial regression.

**Ideas to extend:**
- Interactive health equity map of BC
- Opioid crisis prediction & response tool
- Resource allocation optimizer for Island Health
- What-if simulator for healthcare policy changes
- Cross-province health system benchmarking

---

## 🌐 Live APIs & External Data

For teams that want to go beyond the starter kit:

| Resource | URL | What It Offers |
|----------|-----|----------------|
| HAPI FHIR Test Server | `http://hapi.fhir.org/baseR4` | Free FHIR R4 sandbox — read/write patient data |
| CMS Blue Button Sandbox | `https://sandbox.bluebutton.cms.gov` | Synthetic Medicare claims in FHIR format |
| SMART Bulk Data Server | `https://bulk-data.smarthealthit.org` | Test bulk FHIR data export |
| MedMNIST | `pip install medmnist` | 18 pre-processed medical imaging datasets |
| ClinicalTrials.gov API | `https://clinicaltrials.gov/data-api/api` | 400K+ clinical trials, downloadable as CSV |
| Statistics Canada | `https://www.statcan.gc.ca/en/subjects-start/health` | Canadian health statistics tables (CSV) |
| CIHI Data Tables | `https://www.cihi.ca/en/access-data-and-reports/data-tables` | 233+ Canadian health system data tables (XLSX) |
| PHAC Open Data | `https://search.open.canada.ca/opendata?owner_org=phac-aspc` | Public health surveillance data (CSV) |

### FHIR Quick Test
```bash
# Test FHIR connectivity
curl http://hapi.fhir.org/baseR4/Patient?_count=1
```

```python
# Python FHIR client
# pip install fhirpy
import asyncio
from fhirpy import AsyncFHIRClient

client = AsyncFHIRClient('http://hapi.fhir.org/baseR4')
patients = await client.resources('Patient').limit(10).fetch()
```

---

## 📦 Python Packages

### Required (included in requirements.txt)
```
pandas
numpy
matplotlib
seaborn
scikit-learn
jupyter
faker
requests
openpyxl
```

### Recommended (install as needed)
```
plotly          # Interactive visualizations
streamlit       # Quick web app prototyping
gradio          # ML demo interfaces
fhirpy          # FHIR API client
medmnist        # Medical imaging datasets
transformers    # NLP models (HuggingFace)
xgboost         # Gradient boosting
shap            # Model explainability
```

### Install Everything
```bash
pip install -r requirements.txt

# Optional extras
pip install plotly streamlit gradio fhirpy medmnist
```

---

## 🏥 BC Healthcare Context

For teams unfamiliar with the Canadian healthcare system:

- **MSP (Medical Services Plan):** BC's universal public health insurance — every resident has an MSP number
- **CTAS (Canadian Triage and Acuity Scale):** 5-level triage system used in all Canadian EDs
  - Level 1: Resuscitation (immediate)
  - Level 2: Emergent (≤15 min)
  - Level 3: Urgent (≤30 min)
  - Level 4: Less Urgent (≤60 min)
  - Level 5: Non-Urgent (≤120 min)
- **ICD-10-CA:** Canadian version of the International Classification of Diseases
- **DIN (Drug Identification Number):** 8-digit number assigned by Health Canada to each drug product
- **Island Health:** The health authority serving Vancouver Island (including Victoria)
- **CIHI:** Canadian Institute for Health Information — national health data organization
- **PHAC:** Public Health Agency of Canada

---

## 📄 Data Licensing

All synthetic data in this kit is generated for educational purposes and carries no licensing restrictions.

For real datasets referenced in the download helpers:
- **Statistics Canada:** Open Government Licence - Canada
- **CIHI:** Free data tables available for public use
- **PHAC:** Open Government Licence - Canada

---

## 🤝 Credits

Built for the **UVic Healthcare AI Hackathon** (March 27-28, 2026).

Data generation powered by Python, pandas, numpy, and Faker.
Inspired by real BC healthcare patterns — but 100% synthetic.

**Questions?** Ask a mentor or organizer. Good luck and happy hacking! 🚀
