# ERPAC Chatbot API

## Endpoint

POST /webhook

## Request
```json
{
  "session_id": "user_123",
  "message": "je veux un devis"
}
```

## Response
```json
{
  "reply": "Type de projet ? (ex: villa, commerce, clinique)",
  "next_step": "devis",
  "store": { "devis_step": 0, "devis_data": {} }
}
```

## next_step values
| Value    | Meaning                    |
|----------|----------------------------|
| idle     | No active flow             |
| devis    | Devis flow in progress     |
| handoff  | Transfer to human agent    |

## Intent keywords (FR)
| Intent          | Triggers                                      |
|-----------------|-----------------------------------------------|
| info_entreprise | erpac, entreprise, société, expérience        |
| services        | service, construction, piscine, travaux       |
| localisation    | adresse, où, bureau, situé                    |
| contact         | téléphone, email, joindre, numéro             |
| projets         | projet, réalisation, villa, hangar            |
| devis           | devis, tarif, prix, coût                      |
| human_handoff   | humain, conseiller, parler à                  |
| fallback        | (anything unmatched)                          |

## Devis flow steps
1. type_projet
2. ville
3. surface
4. budget
5. delai
6. nom
7. telephone
8. email
→ Confirmation + reset

## Health check
GET /health → { "status": "ok" }
