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
		buffer: make([]byte, 4194304),
	}
}

// NextNAL reads the next NAL unit from the stream
func (h *H264Reader) NextNAL() ([]byte, error) {
	for {
		// Search for start code in the accumulated leftover buffer
		startPayload, nextStart, _ := findNAL(h.leftover)

		if startPayload >= 0 && nextStart >= 0 {
			// Found a complete NAL unit
			nal := h.leftover[startPayload:nextStart]
			// Keep the rest of the buffer from the start of the *next* NAL
			h.leftover = h.leftover[nextStart:]
			return nal, nil
		}

		// Not enough data for a full NAL, read more from the underlying stream
		n, err := h.reader.Read(h.buffer)
		if n > 0 {
			h.leftover = append(h.leftover, h.buffer[:n]...)
		}

		if err != nil {
			if err == io.EOF {
				if len(h.leftover) > 0 {
					startPayload, _, _ := findNAL(h.leftover)
					if startPayload >= 0 {
						nal := h.leftover[startPayload:]
						h.leftover = nil
						return nal, nil
					}
				}
			}
			return nil, err
		}
	}
}

// findNAL returns:
// 1. startPayload: index of the first byte of NAL payload (after start code)
// 2. nextStart: index of the start of the NEXT start code (or -1 if not found)
// 3. startCodeLen: length of the found start code (3 or 4)
func findNAL(data []byte) (int, int, int) {
	if len(data) < 4 {
		return -1, -1, 0
	}

	start := -1
	startCodeLen := 0

	// Find first start code
	for i := 0; i < len(data)-2; i++ {
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			start = i
			startCodeLen = 3
			if i > 0 && data[i-1] == 0 {
				start = i - 1
				startCodeLen = 4
			}
			break
		}
	}

	if start == -1 {
		return -1, -1, 0
	}

	startPayload := start + startCodeLen

	// Now find the NEXT start code to determine end of this NAL
	nextStart := -1
	for i := startPayload; i < len(data)-2; i++ {
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 {
			if i > 0 && data[i-1] == 0 {
				nextStart = i - 1
			} else {
				nextStart = i
			}
			break
		}
	}

	return startPayload, nextStart, startCodeLen
}
