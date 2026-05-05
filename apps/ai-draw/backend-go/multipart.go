package main

import (
	"bytes"
	"mime/multipart"
	"net/textproto"
)

type multipartPart struct {
	Name        string
	Value       string
	Filename    string
	ContentType string
	Bytes       []byte
}

func buildMultipartFormData(parts []multipartPart) ([]byte, string, error) {
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	for _, part := range parts {
		if part.Filename == "" {
			if err := writer.WriteField(part.Name, part.Value); err != nil {
				return nil, "", err
			}
			continue
		}
		header := make(textproto.MIMEHeader)
		header.Set("Content-Disposition", `form-data; name="`+part.Name+`"; filename="`+part.Filename+`"`)
		if part.ContentType != "" {
			header.Set("Content-Type", part.ContentType)
		}
		field, err := writer.CreatePart(header)
		if err != nil {
			return nil, "", err
		}
		if _, err := field.Write(part.Bytes); err != nil {
			return nil, "", err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, "", err
	}
	return body.Bytes(), writer.FormDataContentType(), nil
}
