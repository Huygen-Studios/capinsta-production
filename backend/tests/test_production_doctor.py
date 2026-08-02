from server.production import doctor
from server.clipping_storage.config import MediaStorageConfig
from server.clipping_storage.r2_storage import R2MediaStorage
from server.clipping_storage.repository import R2_UPLOAD_SESSION_COLUMNS


def test_doctor_requires_absolute_writable_worker_roots(monkeypatch, tmp_path):
    names = (
        "AUTOMATIC_CLIPPER_TEMP_ROOT",
        "MEDIA_VARIANT_TEMP_ROOT",
        "TRANSCRIPTION_TEMP_ROOT",
        "CLIPPING_EXPORT_TEMP_ROOT",
    )
    for name in names:
        root = tmp_path / name.lower()
        root.mkdir()
        monkeypatch.setenv(name, str(root))
    report, ok = doctor._worker_root_report()
    assert ok is True
    assert all(value == {"absolute": True, "writable": True} for value in report["workerStorageRoots"].values())

    monkeypatch.setenv("TRANSCRIPTION_TEMP_ROOT", "data/transcription-worker")
    report, ok = doctor._worker_root_report()
    assert ok is False
    assert report["workerStorageRoots"]["TRANSCRIPTION_TEMP_ROOT"]["absolute"] is False


def test_doctor_reports_missing_database_without_secrets(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("ADMIN_DATABASE_URL", raising=False)
    monkeypatch.delenv("POSTGRES_DSN", raising=False)
    report, ok = doctor.build_report()

    assert ok is False
    assert report["database"] == "missing_database_url"
    assert report["backendApiContractVersion"] == 1
    assert "clipping-media-uploads" in report["routeCapabilities"]
    assert "SECRET" not in str(report).upper()


class R2Client:
    def __init__(self):
        self.calls = []

    def head_bucket(self, **kwargs):
        self.calls.append(("head_bucket", kwargs))
        return {}

    def generate_presigned_url(self, operation, **kwargs):
        self.calls.append((operation, kwargs))
        return "https://r2.invalid/signed"

    def upload_file(self, *args, **kwargs):
        self.calls.append(("upload_file", args, kwargs))

    def head_object(self, **kwargs):
        self.calls.append(("head_object", kwargs))
        return {"ContentLength": 19, "ContentType": "video/mp4", "ETag": '"etag"'}

    def delete_object(self, **kwargs):
        self.calls.append(("delete_object", kwargs))

    def create_multipart_upload(self, **kwargs):
        self.calls.append(("create_multipart_upload", kwargs))
        return {"UploadId": "upload-1"}

    def abort_multipart_upload(self, **kwargs):
        self.calls.append(("abort_multipart_upload", kwargs))


def _r2_env(monkeypatch):
    monkeypatch.setenv("CLIPPING_STORAGE_PROVIDER", "r2")
    monkeypatch.setenv("R2_ACCOUNT_ID", "account-id")
    monkeypatch.setenv("R2_ENDPOINT", "https://account-id.r2.cloudflarestorage.com")
    monkeypatch.setenv("R2_ACCESS_KEY_ID", "key")
    monkeypatch.setenv("R2_SECRET_ACCESS_KEY", "secret")


def test_doctor_r2_runtime_check_is_read_only_by_default(monkeypatch):
    _r2_env(monkeypatch)
    client = R2Client()

    def storage_from_config(config):
        return R2MediaStorage(config, client=client)

    monkeypatch.setattr(doctor, "media_storage_from_config", storage_from_config)

    report, ok = doctor._r2_runtime_report()

    assert ok is True
    assert report["r2Runtime"]["presigning"] == "ok"
    assert report["r2Runtime"]["writeTest"] == {"status": "skipped"}
    assert [call[0] for call in client.calls].count("head_bucket") == 3
    assert "upload_file" not in [call[0] for call in client.calls]


def test_doctor_r2_write_test_uploads_deletes_and_aborts(monkeypatch):
    _r2_env(monkeypatch)
    client = R2Client()

    def storage_from_config(config: MediaStorageConfig):
        return R2MediaStorage(config, client=client)

    monkeypatch.setattr(doctor, "media_storage_from_config", storage_from_config)

    report, ok = doctor._r2_runtime_report(write_test=True)

    calls = [call[0] for call in client.calls]
    assert ok is True
    assert report["r2Runtime"]["writeTest"]["status"] == "ok"
    assert "upload_file" in calls
    assert "delete_object" in calls
    assert "create_multipart_upload" in calls
    assert "abort_multipart_upload" in calls


class SchemaConnection:
    def __init__(self, columns):
        self.columns = columns

    class Cursor:
        def __init__(self, columns):
            self.columns = columns
            self.rows = []

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return None

        def execute(self, query):
            if "information_schema.columns" in query:
                self.rows = [(column,) for column in self.columns]
            else:
                definitions = {
                    "media_upload_sessions_storage_provider_check": "CHECK storage_provider IN ('supabase','r2','local')",
                    "media_upload_sessions_protocol_check": "CHECK upload_protocol IN ('tus','s3_multipart')",
                    "media_upload_sessions_multipart_check": "CHECK multipart_state IN ('created','completed','aborted')",
                    "media_upload_sessions_storage_pair_check": "CHECK (length(storage_bucket) > 0)",
                }
                self.rows = list(definitions.items())

        def fetchall(self):
            return self.rows

    def cursor(self):
        return self.Cursor(self.columns)


def test_doctor_detects_missing_0028_columns():
    report, ok = doctor._r2_database_schema_report(
        SchemaConnection(R2_UPLOAD_SESSION_COLUMNS - {"aborted_at"})
    )
    assert ok is False
    assert report["r2DatabaseSchema"]["findings"] == ["missing_column:aborted_at"]


def test_doctor_accepts_complete_0028_schema():
    report, ok = doctor._r2_database_schema_report(
        SchemaConnection(R2_UPLOAD_SESSION_COLUMNS)
    )
    assert ok is True
    assert report["r2DatabaseSchema"] == {"ready": True, "findings": []}
