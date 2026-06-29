.PHONY: build-GeneratePresignedUrlFunction build-ListDocumentsFunction build-RegisterDocumentFunction build-QueryDocumentFunction build-IngestDocumentFunction build-QueryDocumentStreamFunction build-QueryDocumentStreamRerankedFunction build-DeleteDocumentFunction

build-GeneratePresignedUrlFunction build-ListDocumentsFunction build-RegisterDocumentFunction build-QueryDocumentFunction build-IngestDocumentFunction build-QueryDocumentStreamFunction build-QueryDocumentStreamRerankedFunction build-DeleteDocumentFunction:
	cp package.json package-lock.json $(ARTIFACTS_DIR)/
	npm install --omit=dev --prefix $(ARTIFACTS_DIR)
	cp -r dist $(ARTIFACTS_DIR)/
