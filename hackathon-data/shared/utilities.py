"""
Healthcare AI Hackathon - Shared Utilities
University of Victoria, March 27-28, 2026

Common data loading, merging, and analysis helpers for hackathon participants.
All functions expect the hackathon-data/ folder structure created by hackathon_data_setup.py.
"""

import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Optional, Tuple, Union

import numpy as np
import pandas as pd


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
# DEFAULT_DATA_DIR points to the hackathon-data/ root.
# When this file lives at hackathon-data/shared/utilities.py, the parent of
# shared/ is hackathon-data/ itself.
DEFAULT_DATA_DIR: Path = Path(__file__).resolve().parent.parent
TRACK1_DIR: Path = DEFAULT_DATA_DIR / "track-1-clinical-ai" / "synthea-patients"
TRACK2_DIR: Path = DEFAULT_DATA_DIR / "track-2-population-health"
SHARED_DIR: Path = DEFAULT_DATA_DIR / "shared"


def set_data_dir(path: str) -> None:
    """Override the default data directory.

    Call this if your notebook is in a non-standard location and the
    auto-detected paths don't resolve correctly.

    Args:
        path: Absolute or relative path to the ``hackathon-data/`` root.
    """
    global DEFAULT_DATA_DIR, TRACK1_DIR, TRACK2_DIR, SHARED_DIR
    DEFAULT_DATA_DIR = Path(path).resolve()
    TRACK1_DIR = DEFAULT_DATA_DIR / "track-1-clinical-ai" / "synthea-patients"
    TRACK2_DIR = DEFAULT_DATA_DIR / "track-2-population-health"
    SHARED_DIR = DEFAULT_DATA_DIR / "shared"


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _safe_read_csv(filepath: Path, parse_dates: Optional[List[str]] = None) -> pd.DataFrame:
    """Read a CSV with a friendly error message if the file is missing."""
    if not filepath.exists():
        raise FileNotFoundError(
            f"Data file not found: {filepath}\n"
            "Have you run `python hackathon_data_setup.py` yet?\n"
            "If your notebook is in a different directory, call "
            "set_data_dir('/path/to/hackathon-data') first."
        )
    return pd.read_csv(filepath, parse_dates=parse_dates)


# =========================================================================
# DATA LOADING FUNCTIONS
# =========================================================================

def load_patients(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load the synthetic patients dataset.

    Returns a DataFrame with columns: patient_id, first_name, last_name,
    date_of_birth, age, sex, postal_code, blood_type, insurance_number,
    primary_language, emergency_contact_phone.

    The ``date_of_birth`` column is parsed as datetime.

    Args:
        data_dir: Optional override for the synthea-patients directory.
    """
    path = Path(data_dir) if data_dir else TRACK1_DIR
    df = _safe_read_csv(path / "patients.csv", parse_dates=["date_of_birth"])
    return df


def load_encounters(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load the synthetic encounters dataset.

    Returns a DataFrame with 10,000 encounter records including encounter_id,
    patient_id, encounter_date, encounter_type, facility, chief_complaint,
    diagnosis_code, diagnosis_description, triage_level, disposition,
    length_of_stay_hours, attending_physician.

    The ``encounter_date`` column is parsed as datetime.

    Args:
        data_dir: Optional override for the synthea-patients directory.
    """
    path = Path(data_dir) if data_dir else TRACK1_DIR
    df = _safe_read_csv(path / "encounters.csv", parse_dates=["encounter_date"])
    return df


def load_medications(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load the synthetic medications dataset.

    Parses ``start_date`` and ``end_date`` as datetime.

    Args:
        data_dir: Optional override for the synthea-patients directory.
    """
    path = Path(data_dir) if data_dir else TRACK1_DIR
    df = _safe_read_csv(path / "medications.csv", parse_dates=["start_date"])
    df["end_date"] = pd.to_datetime(df["end_date"], errors="coerce")
    return df


def load_labs(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load the synthetic lab results dataset.

    Parses ``collected_date`` as datetime.

    Args:
        data_dir: Optional override for the synthea-patients directory.
    """
    path = Path(data_dir) if data_dir else TRACK1_DIR
    df = _safe_read_csv(path / "lab_results.csv", parse_dates=["collected_date"])
    return df


def load_vitals(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load the synthetic vitals dataset.

    Parses ``recorded_at`` as datetime.

    Args:
        data_dir: Optional override for the synthea-patients directory.
    """
    path = Path(data_dir) if data_dir else TRACK1_DIR
    df = _safe_read_csv(path / "vitals.csv", parse_dates=["recorded_at"])
    return df


def load_drug_reference(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load the Canadian drug reference database from shared/drug-database/.

    Args:
        data_dir: Optional override for the shared directory.
    """
    path = Path(data_dir) if data_dir else SHARED_DIR
    return _safe_read_csv(path / "drug-database" / "canadian_drug_reference.csv")


def load_bc_health_indicators(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load BC community health indicators from Track 2 data.

    Args:
        data_dir: Optional override for the track-2 directory.
    """
    path = Path(data_dir) if data_dir else TRACK2_DIR
    return _safe_read_csv(
        path / "bc-community-profiles" / "bc_health_indicators.csv"
    )


def load_wait_times(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load CIHI-style wait times data from Track 2 data.

    Args:
        data_dir: Optional override for the track-2 directory.
    """
    path = Path(data_dir) if data_dir else TRACK2_DIR
    return _safe_read_csv(path / "cihi-wait-times" / "wait_times_mock.csv")


def load_opioid_data(data_dir: Optional[str] = None) -> pd.DataFrame:
    """Load PHAC-style opioid surveillance data from Track 2 data.

    Args:
        data_dir: Optional override for the track-2 directory.
    """
    path = Path(data_dir) if data_dir else TRACK2_DIR
    return _safe_read_csv(
        path / "opioid-surveillance" / "opioid_harms_mock.csv"
    )


def load_all_clinical() -> Dict[str, pd.DataFrame]:
    """Load all clinical datasets at once.

    Returns:
        A dict with keys ``'patients'``, ``'encounters'``, ``'medications'``,
        ``'labs'``, ``'vitals'``.

    Example::

        data = load_all_clinical()
        patients = data['patients']
        encounters = data['encounters']
    """
    return {
        "patients": load_patients(),
        "encounters": load_encounters(),
        "medications": load_medications(),
        "labs": load_labs(),
        "vitals": load_vitals(),
    }


# =========================================================================
# DATA MERGING FUNCTIONS
# =========================================================================

def merge_patient_encounters(
    patients: Optional[pd.DataFrame] = None,
    encounters: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Join patients with their encounters on ``patient_id``.

    If DataFrames are not provided they are loaded from disk.

    Returns a merged DataFrame with all patient demographics plus encounter
    details. Adds a ``patient_age_at_encounter`` column calculated from DOB
    and encounter date.
    """
    if patients is None:
        patients = load_patients()
    if encounters is None:
        encounters = load_encounters()

    merged = encounters.merge(patients, on="patient_id", how="left")
    merged["patient_age_at_encounter"] = (
        (
            pd.to_datetime(merged["encounter_date"])
            - pd.to_datetime(merged["date_of_birth"])
        ).dt.days
        / 365.25
    ).round(1)
    return merged


def merge_encounter_labs(
    encounters: Optional[pd.DataFrame] = None,
    labs: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Join encounters with their lab results on ``encounter_id``.

    If DataFrames are not provided they are loaded from disk.
    """
    if encounters is None:
        encounters = load_encounters()
    if labs is None:
        labs = load_labs()
    return encounters.merge(labs, on="encounter_id", how="left", suffixes=("", "_lab"))


def merge_encounter_vitals(
    encounters: Optional[pd.DataFrame] = None,
    vitals: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Join encounters with their vitals on ``encounter_id``.

    If DataFrames are not provided they are loaded from disk.  When an
    encounter has multiple vitals rows the *first* recorded set is kept so that
    the result has at most one vitals row per encounter row.
    """
    if encounters is None:
        encounters = load_encounters()
    if vitals is None:
        vitals = load_vitals()

    # Keep only the first vitals reading per encounter to avoid row explosion
    vitals_dedup = (
        vitals.sort_values("recorded_at")
        .drop_duplicates(subset=["encounter_id"], keep="first")
    )
    return encounters.merge(
        vitals_dedup, on="encounter_id", how="left", suffixes=("", "_vitals")
    )


def build_patient_summary(
    patients: Optional[pd.DataFrame] = None,
    encounters: Optional[pd.DataFrame] = None,
    medications: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Build a comprehensive per-patient summary.

    Columns added to the patient demographics:

    - ``total_encounters``: count of encounters per patient
    - ``unique_diagnoses``: count of distinct diagnosis codes
    - ``diagnosis_list``: comma-separated list of diagnosis descriptions
    - ``active_medications``: count of active medications
    - ``medication_list``: comma-separated list of active drug names
    - ``last_encounter_date``: most recent encounter date
    - ``most_common_facility``: facility visited most often
    """
    if patients is None:
        patients = load_patients()
    if encounters is None:
        encounters = load_encounters()
    if medications is None:
        medications = load_medications()

    # Encounter aggregates
    enc_agg = (
        encounters.groupby("patient_id")
        .agg(
            total_encounters=("encounter_id", "count"),
            unique_diagnoses=("diagnosis_code", "nunique"),
            diagnosis_list=("diagnosis_description", lambda s: ", ".join(s.unique())),
            last_encounter_date=("encounter_date", "max"),
            most_common_facility=(
                "facility",
                lambda s: s.mode().iloc[0] if len(s.mode()) > 0 else "",
            ),
        )
        .reset_index()
    )

    # Medication aggregates (active only)
    active_meds = medications[medications["active"] == True]  # noqa: E712
    med_agg = (
        active_meds.groupby("patient_id")
        .agg(
            active_medications=("medication_id", "count"),
            medication_list=("drug_name", lambda s: ", ".join(s.unique())),
        )
        .reset_index()
    )

    summary = patients.merge(enc_agg, on="patient_id", how="left")
    summary = summary.merge(med_agg, on="patient_id", how="left")

    # Fill NaN for patients with no encounters/meds
    summary["total_encounters"] = summary["total_encounters"].fillna(0).astype(int)
    summary["unique_diagnoses"] = summary["unique_diagnoses"].fillna(0).astype(int)
    summary["active_medications"] = summary["active_medications"].fillna(0).astype(int)
    summary["diagnosis_list"] = summary["diagnosis_list"].fillna("")
    summary["medication_list"] = summary["medication_list"].fillna("")

    return summary


# =========================================================================
# ANALYSIS FUNCTIONS
# =========================================================================

def get_high_risk_patients(
    patients: Optional[pd.DataFrame] = None,
    encounters: Optional[pd.DataFrame] = None,
    medications: Optional[pd.DataFrame] = None,
    min_conditions: int = 3,
    min_medications: int = 5,
) -> pd.DataFrame:
    """Identify high-risk patients.

    A patient is flagged as high-risk if they have:

    - ``>= min_conditions`` distinct diagnosis codes, **OR**
    - ``>= min_medications`` active medications.

    Returns a DataFrame of high-risk patients with their summary statistics.
    Useful as a starting point for risk-stratification models.

    Args:
        patients: Patients DataFrame (loaded if *None*).
        encounters: Encounters DataFrame (loaded if *None*).
        medications: Medications DataFrame (loaded if *None*).
        min_conditions: Minimum distinct diagnosis count threshold.
        min_medications: Minimum active-medication count threshold.
    """
    summary = build_patient_summary(patients, encounters, medications)
    high_risk = summary[
        (summary["unique_diagnoses"] >= min_conditions)
        | (summary["active_medications"] >= min_medications)
    ].copy()
    high_risk = high_risk.sort_values("unique_diagnoses", ascending=False)

    print(
        f"Found {len(high_risk):,} high-risk patients "
        f"({len(high_risk) / len(summary) * 100:.1f}% of all patients)"
    )
    print(f"  Criteria: >= {min_conditions} conditions OR >= {min_medications} active meds")
    return high_risk.reset_index(drop=True)


def calculate_readmission_rate(
    encounters: Optional[pd.DataFrame] = None,
    window_days: int = 30,
) -> pd.DataFrame:
    """Calculate readmission rates within a given window.

    A *readmission* is defined as an **inpatient** encounter that occurs
    within ``window_days`` of a previous inpatient discharge for the same
    patient.

    Returns a DataFrame with columns:

    - ``patient_id``
    - ``index_encounter_id`` — the initial encounter
    - ``index_discharge_date``
    - ``readmission_encounter_id`` — the readmission encounter (NaN if none)
    - ``readmission_date``
    - ``days_to_readmission``
    - ``was_readmitted`` — boolean

    Also prints the overall readmission rate.
    """
    if encounters is None:
        encounters = load_encounters()

    # Focus on admitted / inpatient encounters
    inpatient = (
        encounters[encounters["disposition"] == "admitted"]
        .copy()
        .sort_values(["patient_id", "encounter_date"])
    )

    inpatient["encounter_date"] = pd.to_datetime(inpatient["encounter_date"])
    # Approximate discharge date = encounter_date + length_of_stay
    inpatient["discharge_date"] = inpatient["encounter_date"] + pd.to_timedelta(
        inpatient["length_of_stay_hours"].fillna(0), unit="h"
    )

    results: List[Dict] = []
    for pid, group in inpatient.groupby("patient_id"):
        rows = group.reset_index(drop=True)
        for i in range(len(rows)):
            idx_enc = rows.iloc[i]
            readmitted = False
            readm_eid = np.nan
            readm_date = pd.NaT
            days_to = np.nan

            if i + 1 < len(rows):
                next_enc = rows.iloc[i + 1]
                gap = (next_enc["encounter_date"] - idx_enc["discharge_date"]).days
                if 0 <= gap <= window_days:
                    readmitted = True
                    readm_eid = next_enc["encounter_id"]
                    readm_date = next_enc["encounter_date"]
                    days_to = gap

            results.append(
                {
                    "patient_id": pid,
                    "index_encounter_id": idx_enc["encounter_id"],
                    "index_discharge_date": idx_enc["discharge_date"],
                    "readmission_encounter_id": readm_eid,
                    "readmission_date": readm_date,
                    "days_to_readmission": days_to,
                    "was_readmitted": readmitted,
                }
            )

    df = pd.DataFrame(results)
    total = len(df)
    readmitted_count = df["was_readmitted"].sum()
    rate = readmitted_count / total * 100 if total > 0 else 0

    print(f"{window_days}-day readmission rate: {rate:.1f}%")
    print(f"  {readmitted_count:,} readmissions out of {total:,} inpatient encounters")
    return df


def calculate_los_statistics(
    encounters: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    """Calculate length-of-stay statistics by encounter type and facility.

    Returns a DataFrame with mean, median, std, min, and max LOS for each
    combination of ``encounter_type`` and ``facility``.
    """
    if encounters is None:
        encounters = load_encounters()

    stats = (
        encounters.groupby(["encounter_type", "facility"])["length_of_stay_hours"]
        .agg(["mean", "median", "std", "min", "max", "count"])
        .round(1)
        .reset_index()
    )
    stats.columns = [
        "encounter_type",
        "facility",
        "mean_los_hours",
        "median_los_hours",
        "std_los_hours",
        "min_los_hours",
        "max_los_hours",
        "encounter_count",
    ]
    return stats


def top_diagnoses(
    encounters: Optional[pd.DataFrame] = None,
    n: int = 20,
) -> pd.DataFrame:
    """Return the top *n* most common diagnoses with counts and percentages.

    Args:
        encounters: Encounters DataFrame (loaded if *None*).
        n: Number of top diagnoses to return.
    """
    if encounters is None:
        encounters = load_encounters()

    counts = (
        encounters.groupby(["diagnosis_code", "diagnosis_description"])
        .size()
        .reset_index(name="count")
        .sort_values("count", ascending=False)
        .head(n)
    )
    counts["pct"] = (counts["count"] / len(encounters) * 100).round(1)
    return counts.reset_index(drop=True)


def patient_demographics_summary(
    patients: Optional[pd.DataFrame] = None,
) -> Dict:
    """Return a dict with key demographic statistics.

    Keys:

    - ``total_patients``
    - ``mean_age``, ``median_age``, ``age_std``
    - ``sex_distribution`` — dict of sex -> count
    - ``blood_type_distribution`` — dict of blood_type -> count
    - ``language_distribution`` — dict of language -> count
    - ``postal_code_distribution`` — dict of FSA prefix -> count
    """
    if patients is None:
        patients = load_patients()

    fsa_counts = patients["postal_code"].str[:3].value_counts().to_dict()

    return {
        "total_patients": len(patients),
        "mean_age": round(patients["age"].mean(), 1),
        "median_age": int(patients["age"].median()),
        "age_std": round(patients["age"].std(), 1),
        "sex_distribution": patients["sex"].value_counts().to_dict(),
        "blood_type_distribution": patients["blood_type"].value_counts().to_dict(),
        "language_distribution": patients["primary_language"].value_counts().to_dict(),
        "postal_code_distribution": fsa_counts,
    }


# =========================================================================
# FHIR CONVERSION
# =========================================================================

def _language_to_bcp47(language: str) -> str:
    """Map a language name to its BCP-47 code."""
    mapping = {
        "English": "en",
        "French": "fr",
        "Mandarin": "zh",
        "Punjabi": "pa",
        "Other": "und",
    }
    return mapping.get(language, "und")


def patient_to_fhir(patient_row: Union[pd.Series, Dict]) -> Dict:
    """Convert a patient record to a FHIR R4 Patient resource.

    Mapping:

    - ``patient_id`` -> identifier
    - ``first_name``, ``last_name`` -> name
    - ``date_of_birth`` -> birthDate
    - ``sex`` -> gender (F -> female, M -> male)
    - ``postal_code`` -> address.postalCode
    - ``insurance_number`` -> identifier (MSP)
    - ``primary_language`` -> communication.language

    Args:
        patient_row: A pandas Series (e.g. ``patients.iloc[0]``) or dict.

    Returns:
        A dict conforming to the FHIR R4 Patient resource structure.
    """
    if isinstance(patient_row, pd.Series):
        patient_row = patient_row.to_dict()

    return {
        "resourceType": "Patient",
        "id": patient_row.get("patient_id", ""),
        "meta": {
            "profile": [
                "http://hl7.org/fhir/ca/core/StructureDefinition/profile-patient"
            ]
        },
        "identifier": [
            {
                "system": "https://hackathon.uvic.ca/patient-id",
                "value": patient_row.get("patient_id", ""),
            },
            {
                "type": {
                    "coding": [
                        {
                            "system": "http://terminology.hl7.org/CodeSystem/v2-0203",
                            "code": "JHN",
                            "display": "Jurisdictional health number",
                        }
                    ]
                },
                "system": "https://www2.gov.bc.ca/gov/content/health/health-drug-coverage/msp",
                "value": str(patient_row.get("insurance_number", "")),
            },
        ],
        "name": [
            {
                "use": "official",
                "family": patient_row.get("last_name", ""),
                "given": [patient_row.get("first_name", "")],
            }
        ],
        "gender": "female" if patient_row.get("sex") == "F" else "male",
        "birthDate": str(patient_row.get("date_of_birth", ""))[:10],
        "address": [
            {
                "use": "home",
                "city": "Victoria",
                "state": "BC",
                "postalCode": patient_row.get("postal_code", ""),
                "country": "CA",
            }
        ],
        "communication": [
            {
                "language": {
                    "coding": [
                        {
                            "system": "urn:ietf:bcp:47",
                            "code": _language_to_bcp47(
                                patient_row.get("primary_language", "English")
                            ),
                            "display": patient_row.get(
                                "primary_language", "English"
                            ),
                        }
                    ]
                },
                "preferred": True,
            }
        ],
    }


def encounter_to_fhir(encounter_row: Union[pd.Series, Dict]) -> Dict:
    """Convert an encounter record to a FHIR R4 Encounter resource.

    Maps ``encounter_type`` to FHIR class codes, ``diagnosis_code`` to
    ``reasonCode``, ``triage_level`` to ``priority``, and ``facility`` to
    ``serviceProvider``.

    Args:
        encounter_row: A pandas Series or dict.

    Returns:
        A dict conforming to the FHIR R4 Encounter resource structure.
    """
    if isinstance(encounter_row, pd.Series):
        encounter_row = encounter_row.to_dict()

    class_map = {
        "emergency": {"code": "EMER", "display": "emergency"},
        "outpatient": {"code": "AMB", "display": "ambulatory"},
        "inpatient": {"code": "IMP", "display": "inpatient encounter"},
    }

    enc_type = encounter_row.get("encounter_type", "outpatient")
    fhir_class = class_map.get(enc_type, class_map["outpatient"])

    return {
        "resourceType": "Encounter",
        "id": encounter_row.get("encounter_id", ""),
        "status": "finished",
        "class": {
            "system": "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            "code": fhir_class["code"],
            "display": fhir_class["display"],
        },
        "subject": {
            "reference": f"Patient/{encounter_row.get('patient_id', '')}"
        },
        "period": {
            "start": str(encounter_row.get("encounter_date", ""))[:10],
        },
        "reasonCode": [
            {
                "coding": [
                    {
                        "system": "http://hl7.org/fhir/sid/icd-10-ca",
                        "code": encounter_row.get("diagnosis_code", ""),
                        "display": encounter_row.get("diagnosis_description", ""),
                    }
                ]
            }
        ],
        "priority": {
            "coding": [
                {
                    "system": "https://www.ctas-phctas.ca",
                    "code": str(encounter_row.get("triage_level", 3)),
                    "display": f"CTAS Level {encounter_row.get('triage_level', 3)}",
                }
            ]
        },
        "serviceProvider": {
            "display": encounter_row.get("facility", "")
        },
    }


def observation_to_fhir(lab_row: Union[pd.Series, Dict]) -> Dict:
    """Convert a lab result to a FHIR R4 Observation resource.

    Maps ``test_code`` to code (LOINC), ``value``/``unit`` to
    ``valueQuantity``, and ``abnormal_flag`` to ``interpretation``.

    Args:
        lab_row: A pandas Series or dict.

    Returns:
        A dict conforming to the FHIR R4 Observation resource structure.
    """
    if isinstance(lab_row, pd.Series):
        lab_row = lab_row.to_dict()

    interp_map = {
        "H": {"code": "H", "display": "High"},
        "L": {"code": "L", "display": "Low"},
        "N": {"code": "N", "display": "Normal"},
    }
    flag = lab_row.get("abnormal_flag", "N")
    interp = interp_map.get(flag, interp_map["N"])

    return {
        "resourceType": "Observation",
        "id": lab_row.get("lab_id", ""),
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "laboratory",
                        "display": "Laboratory",
                    }
                ]
            }
        ],
        "code": {
            "coding": [
                {
                    "system": "http://loinc.org",
                    "code": lab_row.get("test_code", ""),
                    "display": lab_row.get("test_name", ""),
                }
            ]
        },
        "subject": {
            "reference": f"Patient/{lab_row.get('patient_id', '')}"
        },
        "encounter": {
            "reference": f"Encounter/{lab_row.get('encounter_id', '')}"
        },
        "effectiveDateTime": str(lab_row.get("collected_date", ""))[:10],
        "valueQuantity": {
            "value": lab_row.get("value"),
            "unit": lab_row.get("unit", ""),
            "system": "http://unitsofmeasure.org",
        },
        "referenceRange": [
            {
                "low": {
                    "value": lab_row.get("reference_range_low"),
                    "unit": lab_row.get("unit", ""),
                },
                "high": {
                    "value": lab_row.get("reference_range_high"),
                    "unit": lab_row.get("unit", ""),
                },
            }
        ],
        "interpretation": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                        "code": interp["code"],
                        "display": interp["display"],
                    }
                ]
            }
        ],
    }


def batch_to_fhir_bundle(
    records: List[Dict],
    resource_type: str = "Patient",
) -> Dict:
    """Convert a list of FHIR resources into a FHIR Bundle (type: collection).

    Args:
        records: List of FHIR resource dicts (from ``patient_to_fhir``, etc.).
        resource_type: ``"Patient"``, ``"Encounter"``, or ``"Observation"``.

    Returns:
        A FHIR Bundle dict.
    """
    return {
        "resourceType": "Bundle",
        "type": "collection",
        "total": len(records),
        "entry": [
            {"fullUrl": f"urn:uuid:{r.get('id', '')}", "resource": r}
            for r in records
        ],
    }


def save_fhir_bundle(bundle: Dict, filepath: str) -> None:
    """Save a FHIR bundle to a JSON file.

    Args:
        bundle: A FHIR Bundle dict from :func:`batch_to_fhir_bundle`.
        filepath: Destination file path.
    """
    with open(filepath, "w") as f:
        json.dump(bundle, f, indent=2, default=str)
    print(f"Saved FHIR bundle ({bundle.get('total', 0)} resources) to {filepath}")


# =========================================================================
# QUICK STATS (pretty printing)
# =========================================================================

def dataset_overview() -> None:
    """Print a formatted overview of all available datasets.

    Shows row counts, column counts, and file sizes for every CSV in the
    hackathon data kit. Useful to run at the top of a notebook to orient
    yourself.
    """
    print("=" * 70)
    print("  UVic Healthcare AI Hackathon - Dataset Overview")
    print("=" * 70)

    datasets = [
        ("Patients", "track-1-clinical-ai/synthea-patients/patients.csv", load_patients),
        ("Encounters", "track-1-clinical-ai/synthea-patients/encounters.csv", load_encounters),
        ("Medications", "track-1-clinical-ai/synthea-patients/medications.csv", load_medications),
        ("Lab Results", "track-1-clinical-ai/synthea-patients/lab_results.csv", load_labs),
        ("Vitals", "track-1-clinical-ai/synthea-patients/vitals.csv", load_vitals),
        ("BC Health Indicators", "track-2-population-health/bc-community-profiles/bc_health_indicators.csv", load_bc_health_indicators),
        ("Wait Times", "track-2-population-health/cihi-wait-times/wait_times_mock.csv", load_wait_times),
        ("Opioid Surveillance", "track-2-population-health/opioid-surveillance/opioid_harms_mock.csv", load_opioid_data),
        ("Drug Reference", "shared/drug-database/canadian_drug_reference.csv", load_drug_reference),
    ]

    for name, rel_path, loader in datasets:
        try:
            df = loader()
            full_path = DEFAULT_DATA_DIR / rel_path
            size_kb = os.path.getsize(full_path) / 1024 if full_path.exists() else 0
            cols_preview = ", ".join(df.columns[:8])
            if len(df.columns) > 8:
                cols_preview += "..."
            print(f"\n  {name}")
            print(f"   Rows: {len(df):,}  |  Columns: {len(df.columns)}  |  Size: {size_kb:.0f} KB")
            print(f"   Columns: {cols_preview}")
        except Exception as e:
            print(f"\n  {name}: Could not load - {e}")

    print("\n" + "=" * 70)
    print("  Use load_patients(), load_encounters(), etc. to get started!")
    print("=" * 70)
