# WEBRTC Library common for nodejs

## 1. Build
> npm run build

- tại project cha dùng thư viện
  - Local: `"webrtc-common": "file:webrtc-common",`
  - Online: public lên registry server như npm package rồi import như thuường

## 2. Tài liệu tổng quan
- TODO

## 3. Data channel
- cho phép gửi nhận message qua rtc giữa các peers
- Sơ đồ:
  Dưới đây là **sequence diagram** thể hiện quy trình “bắt tay” (signaling + ICE + DTLS/SCTP) mở **WebRTC DataChannel** giữa A và B, với **A là người tạo room**.

### 1) Trường hợp phổ biến: A tạo DataChannel trước (in-band, `negotiated: false`)

```mermaid
sequenceDiagram
    autonumber
    participant A as Peer A (room owner)
    participant Sig as Signaling Server
    participant B as Peer B (joiner)
    Note over A,B: Cả hai đã có RTCPeerConnection (PC)

    A->>A: A tạo DataChannel (dc = pcA.createDataChannel("chat"))
    A->>A: pcA.createOffer()
    A->>A: pcA.setLocalDescription(offer)
    A->>Sig: Gửi SDP Offer + local ICE (trickle)
    Sig-->>B: Chuyển Offer + ICE của A

    B->>B: pcB.setRemoteDescription(offer)
    Note over B: DataChannel “chat” sẽ auto xuất hiện khi kết nối thành công (ondatachannel)
    B->>B: pcB.createAnswer()
    B->>B: pcB.setLocalDescription(answer)
    B->>Sig: Gửi SDP Answer + local ICE (trickle)
    Sig-->>A: Chuyển Answer + ICE của B

    A->>A: pcA.setRemoteDescription(answer)

    par Trao đổi ICE (Trickle ICE)
        A->>Sig: A gửi ICE candidates
        Sig-->>B: ICE từ A
        B->>B: pcB.addIceCandidate()

        B->>Sig: B gửi ICE candidates
        Sig-->>A: ICE từ B
        A->>A: pcA.addIceCandidate()
    end

    Note over A,B: ICE Connected → DTLS handshake → SCTP association
    A-->>B: DTLS/SCTP thiết lập xong
    A-->>B: DataChannel state = open (cả hai phía)
    A->>B: dc.send("hello")
```

Rồi 👍. Mình sẽ vẽ sơ đồ với **nhiều client (B1, B2, B3)** join vào room do **A làm host**.
Mỗi khi có client join, **A tạo PeerConnection riêng + DataChannel riêng**, rồi mapping chúng theo `sid` (session id).

---

### 🌐 Luồng tổng quát

1. **A tạo room ws 1234**.
2. **B1, B2, B3** lần lượt join → signaling server báo cho A.
3. Với mỗi client mới:

   * A tạo `pcA_Bx = new RTCPeerConnection()`
   * A tạo `dcA_Bx = pcA_Bx.createDataChannel("chat")`
   * A gửi Offer cho client.
   * Client setRemote → Answer → gửi lại.
   * A setRemote Answer.
   * ICE trao đổi → DataChannel open.
4. A quản lý một **bảng mapping**:

   ```js
   {
     "B1-sid": { pc: pcA_B1, dc: dcA_B1 },
     "B2-sid": { pc: pcA_B2, dc: dcA_B2 },
     "B3-sid": { pc: pcA_B3, dc: dcA_B3 }
   }
   ```

---

### 📌 Sơ đồ

```mermaid
sequenceDiagram
    autonumber
    participant A as Peer A (Room Owner)
    participant Sig as Signaling Server
    participant B1 as Peer B1
    participant B2 as Peer B2

    Note over A: A tạo room ws=1234

    B1->>Sig: join room 1234
    Sig-->>A: Thông báo B1 join
    A->>A: pcA_B1 = new RTCPeerConnection()
    A->>A: dcA_B1 = pcA_B1.createDataChannel("chat")
    Note over A: A quản lý mapping<br>{"B1-sid": pcA_B1 + dcA_B1,<br>"B2-sid": pcA_B2 + dcA_B2}
    A->>Sig: Gửi offer cho B1
    Sig-->>B1: Offer từ A
    B1->>B1: pcB1 = new RTCPeerConnection()
    B1->>B1: pcB1.setRemoteDescription(offer)
    B1->>B1: pcB1.ondatachannel = (ev)=>{ dcB1 = ev.channel }
    B1->>B1: answer = await pcB1.createAnswer()
    B1->>B1: pcB1.setLocalDescription(answer)
    B1->>Sig: Gửi answer
    Sig-->>A: Answer từ B1
    A->>A: pcA_B1.setRemoteDescription(answer)
    Note over A,B1: ICE trao đổi → DataChannel open (dcA_B1 <<->> dcB1)

    B2->>Sig: join room 1234
    Sig-->>A: Thông báo B2 join
    A->>A: pcA_B2 = new RTCPeerConnection()
    A->>A: dcA_B2 = pcA_B2.createDataChannel("chat")
    A->>Sig: Gửi offer cho B2
    Sig-->>B2: Offer từ A
    B2->>B2: pcB2 = new RTCPeerConnection()
    B2->>B2: pcB2.setRemoteDescription(offer)
    B2->>B2: pcB2.ondatachannel = (ev)=>{ dcB2 = ev.channel }
    B2->>B2: answer = await pcB2.createAnswer()
    B2->>B2: pcB2.setLocalDescription(answer)
    B2->>Sig: Gửi answer
    Sig-->>A: Answer từ B2
    A->>A: pcA_B2.setRemoteDescription(answer)
    Note over A,B2: ICE trao đổi → DataChannel open (dcA_B2 <<->> dcB2)
```

---

### ✅ Ưu điểm mô hình này

* **Quản lý dễ dàng**: A biết chính xác mỗi client tương ứng PeerConnection nào.
* **Có thể broadcast hoặc gửi riêng**:

  * Gửi riêng: `mapping[sid].dc.send(msg)`
  * Gửi broadcast: lặp qua tất cả `mapping`.
* **Scalable**: Có thể mở rộng cho N clients.

### ✅ Giải thích thêm

* Ở phía **A**: gọi `pc.createDataChannel("chat")` trước khi gửi Offer.
* Ở phía **B**: không tạo channel, mà chờ event:

  ```js
  pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      dc.onmessage = (msg) => console.log("Got:", msg.data);
  };
  ```
* Nhờ vậy mà **B chỉ passively nhận** DataChannel, không cần đồng bộ `id` thủ công.

---

### 2) Trường hợp “đàm phán sẵn” (`negotiated: true`)

> Cả A và B đều **tạo DataChannel bằng cùng `id`** và **không** đi kèm trong SDP. Phần còn lại (Offer/Answer, ICE, DTLS/SCTP) giống hệt.

```mermaid
sequenceDiagram
    autonumber
    participant A as Peer A
    participant Sig as Signaling Server
    participant B as Peer B

    A->>A: pcA.createDataChannel("chat", { negotiated: true, id: 0 })
    B->>B: pcB.createDataChannel("chat", { negotiated: true, id: 0 })

    A->>A: pcA.createOffer(), setLocalDescription(offer)
    A->>Sig: Gửi Offer + ICE
    Sig-->>B: Chuyển Offer + ICE

    B->>B: setRemoteDescription(offer)
    B->>B: createAnswer(), setLocalDescription(answer)
    B->>Sig: Gửi Answer + ICE
    Sig-->>A: Chuyển Answer + ICE
    A->>A: setRemoteDescription(answer)

    par Trao đổi ICE
        A->>Sig: ICE A
        Sig-->>B: ICE A
        B->>B: addIceCandidate()

        B->>Sig: ICE B
        Sig-->>A: ICE B
        A->>A: addIceCandidate()
    end

    Note over A,B: ICE ok → DTLS → SCTP
    A-->>B: DataChannel state = open (vì negotiated cùng id)
```

### Ghi chú nhanh

* **Signaling server** chỉ chuyển tiếp Offer/Answer và ICE (WebSocket/HTTP tuỳ bạn), không phải WebRTC.
* **Thứ tự “mở” DataChannel**:

  * In-band: A gọi `createDataChannel()` trước khi Offer → B nhận qua `ondatachannel`.
  * Negotiated: Cả hai tự tạo với cùng `id`, không có `ondatachannel`.
* DataChannel chỉ **thực sự “open”** sau khi: ICE connected → **DTLS handshake** xong → **SCTP association** lên.

`negotiated: true` là một **tuỳ chọn khi tạo DataChannel trong WebRTC**, và nó quyết định cách DataChannel được thiết lập giữa hai peer:

---

### 🔹 Mặc định (`negotiated: false`)

* Đây là chế độ phổ biến.
* Khi **A** gọi:

  ```js
  const dc = pcA.createDataChannel("chat");
  ```

  → Thông tin về DataChannel này sẽ được **đính kèm vào SDP Offer**.
* **B** sau khi nhận Offer/Answer sẽ **không cần gọi createDataChannel()**.
* Thay vào đó, B sẽ nhận kênh này qua sự kiện:

  ```js
  pcB.ondatachannel = (event) => {
      const dc = event.channel;
  };
  ```
* Nói cách khác: **chỉ một phía gọi createDataChannel**, phía kia được “tự động báo” (in-band negotiation).

---

### 🔹 `negotiated: true`

* Nghĩa là **DataChannel này không được báo trong SDP**.
* Hai phía phải **tự thoả thuận trước** về:

  * `label` (tên kênh, ví dụ `"chat"`) → để dễ hiểu
  * `id` (số kênh SCTP, ví dụ `0`) → bắt buộc phải giống nhau
* Cả hai phía đều phải gọi cùng đoạn code:

  ```js
  const dc = pc.createDataChannel("chat", {
      negotiated: true,
      id: 0
  });
  ```
* Không có sự kiện `ondatachannel`, vì cả hai đã “biết sẵn” sẽ tạo kênh này.
* Ưu điểm:

  * Giảm bớt signaling (không cần đưa DataChannel vào SDP).
  * Cho phép bạn kiểm soát chính xác `id` (quan trọng nếu muốn nhiều kênh song song).
* Nhược điểm:

  * Bạn phải tự đồng bộ `id` giữa hai peer → dễ sai nếu không cẩn thận.

---

👉 Tóm gọn:

* **`negotiated: false`** = tiện lợi, một bên tạo, bên kia nhận qua `ondatachannel`.
* **`negotiated: true`** = cả hai bên phải tự tạo trước, với cùng `id`, không có “auto thông báo”.

---

# Video call

## Sơ đồ full mesh A-B-C 6 pc

```mermaid
sequenceDiagram
    autonumber
    participant A as Peer A
    participant B as Peer B
    participant C as Peer C

    Note over A,C: Mỗi peer tạo RTCPeerConnection với các peer khác<br/>và add local stream vào từng connection

    %% A tạo kết nối với B và C
    A->>A: Init Service components
    B->>A: B send request open Video call to A (via websocket server)
    A->>A: Init Webrtc objects
    Note over A: pcB = new RTCPeerConnection() <br> pcB.onicecandidate() send to B <br> pcB.ontrack() set remote stream to HTML video tag <br> pcB.oniceconnectionstatechange logging <br> pcB.onsignalingstatechange logging <br> pcB.pc.addTrack(localStream.getTrack)
    A->>B: [offer] A là master => gửi SDP Offer
    A->>A: mapping PeerConnection B với sid B (lưu vào mapping)

    B->>B: Nếu "Webrtc objects" pcA null => khởi tạo giống step của A: "Init Webrtc objects"
    Note over B: pcA.setRemoteDescription(SDP Offer from A) <br> pcA.createAnswer <br> pcA.setLocalDescription(answer)
    B->>A: [answer] pcA gửi SDP Answer
    B->>B: add pending candidate của A nếu có.

    A->>A: nếu pcB.signalingState === 'have-local-offer' => add 

    A<<->>B: [candidate] Trao đổi ICE Candidate
    A->>B: [pendingCandidate] Lưu ICE nếu chưa sẵn sàng
    B->>A: [pendingCandidate] Lưu ICE nếu chưa sẵn sàng
    B-->>A: [remoteStream] B gửi track cho A
    A-->>B: [remoteStream] A gửi track cho B

    A->>C: [offer] gửi SDP Offer
    C->>A: [answer] gửi SDP Answer
    A<<->>C: [candidate] Trao đổi ICE Candidate
    A->>C: [pendingCandidate] Lưu ICE nếu chưa sẵn sàng
    C->>A: [pendingCandidate] Lưu ICE nếu chưa sẵn sàng
    C-->>A: [remoteStream] C gửi track cho A
    A-->>C: [remoteStream] A gửi track cho C

    %% B tạo kết nối với C
    B->>C: [offer] gửi SDP Offer
    C->>B: [answer] gửi SDP Answer
    B<<->>C: [candidate] Trao đổi ICE Candidate
    B->>C: [pendingCandidate] Lưu ICE nếu chưa sẵn sàng
    C->>B: [pendingCandidate] Lưu ICE nếu chưa sẵn sàng
    C-->>B: [remoteStream] C gửi track cho B
    B-->>C: [remoteStream] B gửi track cho C

    Note over A,C: Khi user thao tác UI<br/>A-->>B: [toggleVideo/toggleMic] gửi event điều khiển<br/>B-->>A: [toggleVideo/toggleMic] gửi event điều khiển
    Note over A,C: Sau khi hoàn tất, có 3 kết nối: A-B, A-C, B-C
```
