package webrtc

import (
	"io"
)

// H264Reader reads H264 NAL units from an io.Reader
type H264Reader struct {
	reader   io.Reader
	buffer   []byte
	leftover []byte
}

// NewH264Reader creates a new H264Reader
func NewH264Reader(r io.Reader) *H264Reader {
	return &H264Reader{
		reader: r,
		buffer: make([]byte, 4096),
	}
}

// NextNAL reads the next NAL unit from the stream
func (h *H264Reader) NextNAL() ([]byte, error) {
	data := h.leftover
	// Read more data until we have a start code or EOF
	for {
		// Search for start code in data
		start, end := findNAL(data)
		if start >= 0 && end >= 0 {
			// Found a complete NAL
			nal := data[start:end]
			h.leftover = data[end:]
			return nal, nil
		}

		// Not found, read more
		n, err := h.reader.Read(h.buffer)
		if n > 0 {
			data = append(data, h.buffer[:n]...)
		}
		if err != nil {
			if err == io.EOF {
				if len(data) > 0 {
					// Return remaining data as last NAL if valid
					// Check if it has start code? Usually file ends with NAL
					// Minimal check: if we have data and it looks like NAL
					if start >= 0 {
						h.leftover = nil
						return data[start:], nil
					}
					return nil, io.EOF
				}
				return nil, io.EOF
			}
			return nil, err
		}
	}
}

// findNAL returns start and end index of the first NAL unit in data
// It looks for 00 00 01 or 00 00 00 01
func findNAL(data []byte) (int, int) {
	// Need at least 3 bytes
	if len(data) < 3 {
		return -1, -1
	}

	start := -1
	// Find first start code
	for i := 0; i < len(data)-2; i++ {
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			start = i
			break
		}
	}

	if start == -1 {
		return -1, -1
	}

	// Determine actual start of NAL content (skip start code)
	// 00 00 01 -> skip 3
	// 00 00 00 01 -> skip 4 (but loop above finds the 00 00 01 part)

	// We return the raw NAL including start code for simple file looping/appending?
	// Pion TrackLocalStaticSample expects Raw NAL unit data WITHOUT the start code (Annex B).
	// So we should strip it.

	// Determine actual start of NAL content
	// For H264Reader used in Pion, we return the NAL including the start code (Annex-B format).
	
	nextStart := -1
	for i := start + 3; i < len(data)-2; i++ {
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			// Found next start code.
			// Check if previous byte is 0 (4-byte start code)
			if i > 0 && data[i-1] == 0 {
				nextStart = i - 1
			} else {
				nextStart = i
			}
			break
		}
	}

	if nextStart != -1 {
		return start, nextStart
	}

	return start, -1 // Incomplete NAL
}
