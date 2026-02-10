# FileHatch 외부 스토리지 연결 가이드

FileHatch는 S3 호환 스토리지와 로컬 마운트(NFS/SMB) 두 가지 유형의 외부 스토리지를 지원합니다.
이 문서에서는 각 유형별 설정 방법을 단계별로 안내합니다.

---

## 목차

1. [사전 준비](#1-사전-준비)
2. [S3 호환 스토리지 연결](#2-s3-호환-스토리지-연결)
   - [AWS S3](#21-aws-s3)
   - [MinIO (셀프호스팅)](#22-minio-셀프호스팅)
   - [기타 S3 호환 서비스](#23-기타-s3-호환-서비스)
3. [로컬 마운트 연결 (NFS/SMB)](#3-로컬-마운트-연결-nfssmb)
   - [NFS 마운트](#31-nfs-마운트)
   - [SMB/CIFS 마운트](#32-smbcifs-마운트)
   - [외장 디스크 마운트](#33-외장-디스크-마운트)
4. [사용자 접근 권한 관리](#4-사용자-접근-권한-관리)
5. [운영 및 관리](#5-운영-및-관리)
6. [문제 해결](#6-문제-해결)

---

## 1. 사전 준비

### 관리자 계정 필요

외부 스토리지 설정은 **관리자(Admin)** 권한이 필요합니다.
관리자 페이지 → **외부 스토리지** 메뉴에서 관리할 수 있습니다.

### 환경 변수 설정 (프로덕션 필수)

외부 스토리지의 연결 정보(Access Key 등)는 **AES-256-GCM**으로 암호화되어 DB에 저장됩니다.
프로덕션 환경에서는 반드시 암호화 키를 설정해야 합니다.

`.env` 파일 또는 `docker-compose.override.yml`에 추가:

```bash
# 32자 이상 권장 (필수)
STORAGE_ENCRYPTION_KEY=your-secure-32-byte-encryption-key
```

> **주의:** 이 키를 설정하지 않으면 기본 키가 사용되며, API 로그에 경고 메시지가 출력됩니다.
> 키를 변경하면 기존에 저장된 스토리지 설정을 복호화할 수 없으므로 재등록이 필요합니다.

---

## 2. S3 호환 스토리지 연결

S3 API를 지원하는 모든 스토리지 서비스를 연결할 수 있습니다.

**지원 서비스:** AWS S3, MinIO, Ceph RGW, Wasabi, Cloudflare R2, IDrive e2, Backblaze B2 등

### 2.1 AWS S3

#### Step 1: AWS IAM 사용자 생성

1. AWS Console → IAM → 사용자 → **사용자 추가**
2. **프로그래밍 방식 액세스** 선택
3. 다음 정책을 연결하거나 인라인 정책 생성:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
        "s3:GetBucketLocation"
      ],
      "Resource": [
        "arn:aws:s3:::your-bucket-name",
        "arn:aws:s3:::your-bucket-name/*"
      ]
    }
  ]
}
```

4. **Access Key ID**와 **Secret Access Key**를 저장

#### Step 2: FileHatch에서 등록

1. 관리자 페이지 → **외부 스토리지** → **외부 스토리지 추가**
2. 다음 정보 입력:

| 항목 | 값 | 설명 |
|------|-----|------|
| 이름 | `회사 S3` | 표시 이름 (자유롭게 입력) |
| 마운트 경로 | `company-s3` | URL 경로에 사용 (영문 소문자, 숫자, 하이픈) |
| 스토리지 타입 | `S3 호환 스토리지` | 드롭다운에서 선택 |
| Endpoint | `https://s3.amazonaws.com` | AWS S3 엔드포인트 |
| Region | `ap-northeast-2` | 서울 리전 (버킷 위치에 맞게 변경) |
| Bucket | `your-bucket-name` | S3 버킷 이름 |
| Access Key ID | `AKIA...` | IAM 사용자의 Access Key |
| Secret Access Key | `wJalr...` | IAM 사용자의 Secret Key |
| Path Style | **끄기 (비활성)** | AWS S3는 비활성화 |
| Prefix | _(빈칸)_ | 버킷 전체 사용 시 비워둠 |

3. **연결 테스트** 클릭하여 연결 확인
4. **저장** 클릭

> **Prefix 활용 예시:** 버킷의 `documents/` 폴더만 사용하려면 Prefix에 `documents/`를 입력합니다.
> 이렇게 하면 사용자에게 해당 폴더 내용만 보입니다.

### 2.2 MinIO (셀프호스팅)

MinIO는 셀프호스팅 가능한 S3 호환 오브젝트 스토리지입니다.

#### 설정 값

| 항목 | 값 | 설명 |
|------|-----|------|
| Endpoint | `https://minio.example.com:9000` | MinIO 서버 주소 (포트 포함) |
| Region | `us-east-1` | 기본값 사용 (MinIO는 보통 무관) |
| Bucket | `filehatch-data` | MinIO에서 생성한 버킷 |
| Access Key ID | MinIO 콘솔에서 발급 | |
| Secret Access Key | MinIO 콘솔에서 발급 | |
| Path Style | **켜기 (활성)** | MinIO는 반드시 활성화 |

> **중요:** MinIO, Ceph RGW 등 셀프호스팅 S3 서비스는 **Path Style을 반드시 활성화**해야 합니다.
> Path Style이 비활성화되면 `bucket.endpoint` 형태의 가상 호스트 URL을 사용하는데,
> 셀프호스팅 환경에서는 이 DNS가 설정되어 있지 않아 연결이 실패합니다.

### 2.3 기타 S3 호환 서비스

| 서비스 | Endpoint | Path Style | Region |
|--------|----------|------------|--------|
| **Cloudflare R2** | `https://<account-id>.r2.cloudflarestorage.com` | 켜기 | `auto` |
| **Wasabi** | `https://s3.wasabisys.com` | 끄기 | `us-east-1` 등 |
| **Backblaze B2** | `https://s3.<region>.backblazeb2.com` | 끄기 | B2 대시보드 확인 |
| **IDrive e2** | `https://<region>.e2.idrivesync.com` | 켜기 | IDrive 대시보드 확인 |

---

## 3. 로컬 마운트 연결 (NFS/SMB)

서버에 마운트된 NFS/SMB 공유 폴더나 외장 디스크를 FileHatch에서 사용할 수 있습니다.
**두 단계**가 필요합니다:

1. **호스트 OS에서 NFS/SMB 마운트** (또는 외장 디스크 연결)
2. **Docker 컨테이너에 볼륨 마운트** 후 FileHatch에 등록

### 3.1 NFS 마운트

#### Step 1: 호스트에서 NFS 마운트

```bash
# 마운트 포인트 생성
sudo mkdir -p /mnt/nas-documents

# NFS 마운트 (일회성)
sudo mount -t nfs 192.168.1.100:/exports/documents /mnt/nas-documents

# 마운트 확인
df -h /mnt/nas-documents
ls -la /mnt/nas-documents
```

#### Step 2: 부팅 시 자동 마운트 (`/etc/fstab`)

```bash
# /etc/fstab에 추가
192.168.1.100:/exports/documents /mnt/nas-documents nfs defaults,_netdev 0 0
```

```bash
# fstab 적용 테스트
sudo mount -a
```

#### Step 3: Docker 볼륨 마운트

`docker-compose.override.yml` 파일을 생성하거나 수정합니다:

```yaml
services:
  api:
    volumes:
      - /mnt/nas-documents:/mnt/nas-documents
```

> `docker-compose.override.yml`은 `docker-compose.yml`과 자동으로 병합됩니다.

컨테이너를 재시작합니다:

```bash
docker compose down api && docker compose up -d api
```

#### Step 4: FileHatch에서 등록

1. 관리자 페이지 → **외부 스토리지** → **외부 스토리지 추가**
2. 다음 정보 입력:

| 항목 | 값 | 설명 |
|------|-----|------|
| 이름 | `NAS 문서` | 표시 이름 |
| 마운트 경로 | `nas-documents` | URL 경로에 사용 |
| 스토리지 타입 | `로컬 마운트` | 드롭다운에서 선택 |
| 서버 경로 | `/mnt/nas-documents` | **컨테이너 내부 경로** |

3. **연결 테스트** → 성공 확인
4. **저장**

### 3.2 SMB/CIFS 마운트

Windows 파일 서버나 NAS의 SMB 공유를 연결합니다.

#### Step 1: 호스트에서 SMB 마운트

```bash
# cifs-utils 설치 (Ubuntu/Debian)
sudo apt install cifs-utils

# 마운트 포인트 생성
sudo mkdir -p /mnt/nas-share

# SMB 마운트 (기본)
sudo mount -t cifs //192.168.1.200/shared /mnt/nas-share \
  -o username=fileuser,password=yourpassword,uid=1000,gid=1000

# 한글 파일명 지원 (iocharset 옵션 추가)
sudo mount -t cifs //192.168.1.200/shared /mnt/nas-share \
  -o username=fileuser,password=yourpassword,uid=1000,gid=1000,iocharset=utf8
```

#### Step 2: 자동 마운트 (자격 증명 파일 사용)

비밀번호를 안전하게 관리하기 위해 자격 증명 파일을 사용합니다:

```bash
# 자격 증명 파일 생성
sudo tee /etc/samba/credentials-nas <<EOF
username=fileuser
password=yourpassword
domain=WORKGROUP
EOF

# 권한 제한
sudo chmod 600 /etc/samba/credentials-nas
```

```bash
# /etc/fstab에 추가
//192.168.1.200/shared /mnt/nas-share cifs credentials=/etc/samba/credentials-nas,uid=1000,gid=1000,iocharset=utf8,_netdev 0 0
```

```bash
# fstab 적용 테스트
sudo mount -a
```

#### Step 3~4: Docker 볼륨 마운트 및 FileHatch 등록

[NFS 마운트의 Step 3~4](#step-3-docker-볼륨-마운트)와 동일합니다.

`docker-compose.override.yml`:

```yaml
services:
  api:
    volumes:
      - /mnt/nas-share:/mnt/nas-share
```

FileHatch 등록 시 **서버 경로**에 `/mnt/nas-share` 입력.

### 3.3 외장 디스크 마운트

USB 외장 디스크나 추가 하드디스크도 동일한 방식으로 연결합니다.

```bash
# 디스크 확인
lsblk

# 마운트
sudo mkdir -p /mnt/external-disk
sudo mount /dev/sdb1 /mnt/external-disk

# 자동 마운트 (/etc/fstab)
# UUID 확인
sudo blkid /dev/sdb1
# fstab 추가
UUID=xxxx-xxxx /mnt/external-disk ext4 defaults,nofail 0 2
```

이후 Docker 볼륨 마운트 및 FileHatch 등록은 위와 동일합니다.

---

## 4. 사용자 접근 권한 관리

외부 스토리지는 등록만으로는 사용자에게 보이지 않습니다.
관리자가 **사용자별로 접근 권한을 부여**해야 합니다.

### 권한 부여

1. 관리자 페이지 → **외부 스토리지** → 대상 스토리지의 **권한** 버튼 클릭
2. 사용자 검색
3. 권한 수준 선택:

| 권한 | 아이콘 | 설명 |
|------|--------|------|
| **읽기** | 눈 모양 | 파일 보기, 다운로드만 가능 |
| **읽기/쓰기** | 연필 모양 | 파일 업로드, 삭제, 이름 변경 등 모든 작업 가능 |

### 권한 변경/제거

- 현재 접근 권한 목록에서 각 사용자의 권한 수준을 변경하거나 제거할 수 있습니다.

### 읽기 전용 스토리지

스토리지 생성/수정 시 **읽기 전용** 토글을 활성화하면, 쓰기 권한을 가진 사용자도 읽기만 가능합니다.
스토리지 전체를 보호해야 할 때 사용합니다.

### 사용자 화면

권한을 부여받은 사용자는 파일 탐색기 좌측에 외부 스토리지가 표시됩니다.
가상 경로 `/external/{마운트경로}`로 접근됩니다.

예: 마운트 경로가 `nas-documents`인 스토리지 → 사용자는 `/external/nas-documents`에서 파일 탐색

---

## 5. 운영 및 관리

### 연결 테스트

스토리지 목록에서 각 스토리지의 **테스트** 버튼을 클릭하면:
- S3: 버킷 접근 및 인증 정보 확인
- 로컬 마운트: 디렉토리 존재 및 읽기 권한 확인
- 응답 시간(ms) 표시
- 성공 시 상태가 **활성**으로, 실패 시 **오류**로 업데이트

### 용량 제한 (Quota)

스토리지 생성/수정 시 **용량 제한**을 설정할 수 있습니다.
- MB, GB, TB 단위 선택 가능
- `0` = 무제한

### 스토리지 상태

| 상태 | 설명 |
|------|------|
| **활성 (active)** | 정상 작동 중 |
| **비활성 (disabled)** | 관리자가 일시 중지 |
| **오류 (error)** | 연결 실패 (오류 메시지 확인) |

비활성 또는 오류 상태의 스토리지는 사용자에게 표시되지 않습니다.

### 설정 수정

- **이름, 용량 제한, 읽기 전용, 상태**: 언제든 수정 가능
- **연결 정보 (S3 키 등)**: 수정 시 기존 값은 마스킹되어 표시됨. 빈칸으로 두면 기존 값 유지
- **마운트 경로**: 생성 후 변경 불가 (변경 필요 시 삭제 후 재생성)

### 스토리지 삭제

스토리지를 삭제하면:
- DB에서 스토리지 설정 및 모든 접근 권한이 제거됩니다
- **실제 파일은 삭제되지 않습니다** (S3 버킷이나 NFS 공유의 파일은 그대로 유지)

---

## 6. 문제 해결

### 연결 테스트 실패

#### S3

| 증상 | 원인 | 해결 |
|------|------|------|
| `Access Denied` | IAM 권한 부족 | S3 버킷에 대한 접근 정책 확인 |
| `NoSuchBucket` | 버킷 이름 오류 | 버킷 이름과 리전 확인 |
| `connection refused` | 엔드포인트 오류 | URL, 포트, 프로토콜(http/https) 확인 |
| `no such host` | Path Style 설정 오류 | MinIO/Ceph → Path Style 활성화 |

#### 로컬 마운트

| 증상 | 원인 | 해결 |
|------|------|------|
| `path not accessible` | Docker 볼륨 미설정 | `docker-compose.override.yml`에 볼륨 추가 후 재시작 |
| `permission denied` | 파일 권한 부족 | 호스트에서 마운트 옵션에 `uid`, `gid` 확인 |
| `not a directory` | 파일 경로 입력됨 | 디렉토리 경로 입력 필요 |
| `no such file or directory` | 마운트 해제됨 | 호스트에서 `mount` 명령으로 마운트 상태 확인 |

### Docker 볼륨 마운트 확인

```bash
# 컨테이너 내부에서 경로 확인
docker compose exec api ls -la /mnt/nas-documents

# 마운트 확인
docker compose exec api df -h
```

### 호스트 마운트 상태 확인

```bash
# NFS 마운트 확인
mount | grep nfs

# SMB 마운트 확인
mount | grep cifs

# 모든 마운트 확인
findmnt -t nfs,nfs4,cifs
```

### API 로그 확인

```bash
docker compose logs -f api
```

출력되는 주요 경고/에러 메시지:
- `WARNING: STORAGE_ENCRYPTION_KEY not set` → 암호화 키 미설정 (프로덕션에서 반드시 설정)
- `failed to decrypt config` → 암호화 키가 변경됨 (스토리지 재등록 필요)
- `mount path not accessible` → Docker 볼륨 마운트 누락

---

## 전체 구성 예시

### docker-compose.override.yml

```yaml
services:
  api:
    environment:
      - STORAGE_ENCRYPTION_KEY=${STORAGE_ENCRYPTION_KEY}
    volumes:
      # NFS 마운트
      - /mnt/nas-documents:/mnt/nas-documents
      # SMB 마운트
      - /mnt/nas-share:/mnt/nas-share
      # 외장 디스크
      - /mnt/external-disk:/mnt/external-disk
```

### .env

```bash
STORAGE_ENCRYPTION_KEY=my-super-secure-32byte-key-here!
```

### FileHatch 등록 요약

| 이름 | 마운트 경로 | 타입 | 주요 설정 |
|------|------------|------|----------|
| 회사 AWS S3 | `company-s3` | S3 | Endpoint: `https://s3.amazonaws.com`, Region: `ap-northeast-2` |
| MinIO 백업 | `minio-backup` | S3 | Endpoint: `https://minio.local:9000`, Path Style: 켜기 |
| NAS 문서 | `nas-documents` | 로컬 마운트 | 서버 경로: `/mnt/nas-documents` |
| 공유 폴더 | `team-share` | 로컬 마운트 | 서버 경로: `/mnt/nas-share` |
