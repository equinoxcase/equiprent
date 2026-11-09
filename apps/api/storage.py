"""S3-compatible object storage for dispute evidence (Railway bucket, R2, S3, MinIO).
Set S3_BUCKET plus the other S3_* variables. With S3_BUCKET unset the API keeps files in the database, which is
only meant for local development."""
import os

BUCKET = os.getenv("S3_BUCKET", "")
_client = None


def enabled() -> bool:
    return bool(BUCKET)


def _c():
    global _client
    if _client is None:
        import boto3
        from botocore.config import Config
        _client = boto3.client(
            "s3",
            endpoint_url=os.getenv("S3_ENDPOINT") or None,
            region_name=os.getenv("S3_REGION", "auto"),
            aws_access_key_id=os.environ["S3_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["S3_SECRET_ACCESS_KEY"],
            config=Config(signature_version="s3v4", s3={"addressing_style": os.getenv("S3_ADDRESSING", "path")}),
        )
    return _client


def put(key: str, data: bytes, content_type: str) -> None:
    _c().put_object(Bucket=BUCKET, Key=key, Body=data, ContentType=content_type)


def get(key: str) -> bytes:
    return _c().get_object(Bucket=BUCKET, Key=key)["Body"].read()
