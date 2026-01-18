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
	data := h.leftover
	// Read more data until we have a start code or EOF
	for {
		// Search for start code in data
		startPayload, nextStart, _ := findNAL(data)

		if startPayload >= 0 && nextStart >= 0 {
			// Found a complete NAL
			// Return NAL WITHOUT start code (Pion Packetizer expects Raw NAL)
			nal := data[startPayload:nextStart]
			h.leftover = data[nextStart:]
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
					// Handle last NAL
					if startPayload >= 0 {
						h.leftover = nil
						// Return remaining data
						return data[startPayload:], nil
					}
					return nil, io.EOF
				}
				return nil, io.EOF
			}
			return nil, err
		}

		// Optimization: if we have a lot of data and no NAL end found yet?
		// We just keep appending.
		h.leftover = data // save state for next iteration (though 'data' variable holds it)
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
	// We scan only the beginning if we assume 'data' starts with a start code?
	// But 'data' comes from h.leftover, which we set to `data[nextStart:]`.
	// So data SHOULD start with a start code (00 00 ...).
	// Let's verify and find it.

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
			// Found next start code sequence
			// Check for 4-byte start code prefix
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
