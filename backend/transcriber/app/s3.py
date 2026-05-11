import boto3
from app import config


def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=config.S3_ENDPOINT,
        region_name=config.S3_REGION,
        aws_access_key_id=config.S3_ACCESS_KEY,
        aws_secret_access_key=config.S3_SECRET_KEY,
    )


def download_to_file(s3_key: str, dest_path: str) -> None:
    client = get_s3_client()
    client.download_file(config.S3_BUCKET, s3_key, dest_path)
