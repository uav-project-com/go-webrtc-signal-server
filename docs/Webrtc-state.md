## 📊 Các trạng thái chính của signalingState

## 🧠 **`signalingState = "stable"` nghĩa là gì?**

Trạng thái `"stable"` có nghĩa là:

> ✅ Peer đã hoàn tất việc đàm phán (offer/answer), hoặc chưa bắt đầu gì cả.
> Không có offer hoặc answer nào đang chờ xử lý.

---

| Trạng thái               | Ý nghĩa                                                               |
| ------------------------ | --------------------------------------------------------------------- |
| `"stable"`               | ✅ Mọi thứ đã "ổn định": không còn pending offer/answer                |
| `"have-local-offer"`     | Bạn đã gọi `setLocalDescription(offer)` → đang chờ answer từ peer     |
| `"have-remote-offer"`    | Bạn đã gọi `setRemoteDescription(offer)` → sẵn sàng tạo và gửi answer |
| `"have-local-pranswer"`  | Đang chờ remote set answer (ít dùng, cho đàm phán chậm)               |
| `"have-remote-pranswer"` | Tương tự, nhưng ngược lại                                             |
| `"closed"`               | PeerConnection đã bị đóng hoàn toàn                                   |

---

### 🔁 Một vòng đàm phán signaling cơ bản

Giả sử bạn là **caller**:

1. `"stable"`
2. → `createOffer()`
3. → `setLocalDescription(offer)` → `"have-local-offer"`
4. → gửi offer cho remote
5. ← nhận answer từ remote
6. → `setRemoteDescription(answer)`
7. → trở về `"stable"`

Tương tự, nếu bạn là **callee**:

1. `"stable"`
2. ← nhận offer từ caller
3. → `setRemoteDescription(offer)` → `"have-remote-offer"`
4. → `createAnswer()`
5. → `setLocalDescription(answer)`
6. → gửi answer lại
7. → trở về `"stable"`

---