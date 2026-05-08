# Test Fixtures — HWP Samples

## sample.hwp

- 출처: [edwardkim/rhwp samples/KTX.hwp](https://github.com/edwardkim/rhwp/blob/main/samples/KTX.hwp)
- 라이선스: rhwp 저장소 MIT (samples 디렉토리는 동일 라이선스로 배포)
- 용도: HWP 뷰어/에디터 e2e 테스트 정상 흐름 검증
- 갱신:
  ```bash
  curl -fsSL -o tests/e2e/fixtures/sample.hwp \
    https://raw.githubusercontent.com/edwardkim/rhwp/main/samples/KTX.hwp
  ```

## corrupted.hwp

- 출처: sample.hwp 의 첫 100바이트만 자른 의도적 손상 파일
- 용도: 로드 실패 시 에러 모달 + 다운로드 버튼 동작 검증
- 갱신:
  ```bash
  head -c 100 tests/e2e/fixtures/sample.hwp > tests/e2e/fixtures/corrupted.hwp
  ```
