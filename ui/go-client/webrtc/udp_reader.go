package webrtc

import (
	"io"
	"log"
	"net"
)

// UDPReader wraps a UDP connection and implements io.Reader
// UDPReader wraps a UDP connection and implements io.Reader with an internal buffer
// to prevents packet loss during downstream blocking/pacing.
type UDPReader struct {
	conn       *net.UDPConn
	packetChan chan []byte
	closed     chan struct{}
}

func NewUDPReader(port int) (*UDPReader, error) {
	addr := &net.UDPAddr{
		Port: port,
		IP:   net.ParseIP("127.0.0.1"),
	}
	conn, err := net.ListenUDP("udp", addr)
	if err != nil {
		return nil, err
	}
	// Increase OS buffer
	conn.SetReadBuffer(4 * 1024 * 1024)

	u := &UDPReader{
		conn: conn,
		// Large buffer to hold ~2000 packets (approx 2MB+ of data)
		// This prevents dropping packets while the consumer is sleeping/pacing.
		packetChan: make(chan []byte, 2048),
		closed:     make(chan struct{}),
	}

	go u.readLoop()

	return u, nil
}

func (u *UDPReader) readLoop() {
	buf := make([]byte, 4096) // Max UDP size usually < 1500
	for {
		select {
		case <-u.closed:
			return
		default:
			n, _, err := u.conn.ReadFromUDP(buf)
			if err != nil {
				// Log only if not closed
				select {
				case <-u.closed:
					return
				default:
					log.Printf("UDP Read Error: %v", err)
				}
				return
			}

			// Copy data to send to channel
			// (Must copy because buf is reused)
			data := make([]byte, n)
			copy(data, buf[:n])

			select {
			case u.packetChan <- data:
			case <-u.closed:
				return
			default:
				// Channel full - Drop packet?
				// With 2048 buffer, this shouldn't happen unless consumer is DEAD.
				log.Println("UDPReader: Internal Buffer Full! Dropping packet.")
			}
		}
	}
}

func (u *UDPReader) Read(p []byte) (n int, err error) {
	// Read from channel
	select {
	case data := <-u.packetChan:
		if len(data) > len(p) {
			log.Printf("UDPReader: Buffer too short! Packet size %d, Buffer size %d. Truncating...", len(data), len(p))
		}
		return copy(p, data), nil
	case <-u.closed:
		return 0, io.EOF
	}
}

func (u *UDPReader) Close() error {
	select {
	case <-u.closed:
		return nil
	default:
		close(u.closed)
	}
	return u.conn.Close()
}
