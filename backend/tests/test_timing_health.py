from ai_pipeline.timing import _stable_ts_import_error


def test_stable_ts_import_error_is_clear_when_primary_import_works():
    assert (
        _stable_ts_import_error(
            {
                "available": True,
                "importable": True,
                "version": "2.19.1",
                "error": None,
            },
            {
                "available": False,
                "importable": False,
                "version": None,
                "error": "module_not_found",
            },
        )
        is None
    )


def test_stable_ts_import_error_reports_when_no_import_path_works():
    assert _stable_ts_import_error(
        {
            "available": False,
            "importable": False,
            "version": None,
            "error": "module_not_found",
        },
        {
            "available": False,
            "importable": False,
            "version": None,
            "error": "module_not_found",
        },
    ) == "module_not_found"
