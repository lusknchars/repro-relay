//! Paired dashboard: principals, pairing and isolation. No live model or agent calls.
use sqlx::PgPool;

#[sqlx::test(migrations = "./migrations")]
async fn schema_keeps_one_identity_per_handle_and_one_message_per_platform_id(pool: PgPool) {
    sqlx::query("INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i1','d1','Ana')")
        .execute(&pool)
        .await
        .expect("first identity inserts");

    let duplicate_handle = sqlx::query(
        "INSERT INTO chat_identities(id,handle_digest,display_name) VALUES('i2','d1','Ana again')",
    )
    .execute(&pool)
    .await;
    assert!(duplicate_handle.is_err(), "handle_digest must be unique");

    sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES('m1','i1','in','hello','imessage','p1')")
        .execute(&pool)
        .await
        .expect("first message inserts");

    let replay = sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES('m2','i1','in','hello','imessage','p1')")
        .execute(&pool)
        .await;
    assert!(replay.is_err(), "a replayed platform message id must not duplicate");

    let bad_direction = sqlx::query("INSERT INTO chat_messages(id,identity_id,direction,body,platform,platform_message_id) VALUES('m3','i1','sideways','x','imessage','p2')")
        .execute(&pool)
        .await;
    assert!(bad_direction.is_err(), "direction is constrained to in or out");
}
