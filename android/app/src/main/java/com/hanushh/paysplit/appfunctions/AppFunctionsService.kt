package com.hanushh.paysplit.appfunctions

import android.content.Context
import androidx.appfunctions.AppFunction
import androidx.appfunctions.AppFunctionContext
import com.hanushh.paysplit.appfunctions.models.ActivityFeedResult
import com.hanushh.paysplit.appfunctions.models.ActivityItem
import com.hanushh.paysplit.appfunctions.models.ExpenseResult
import com.hanushh.paysplit.appfunctions.models.GroupBalancesResult
import com.hanushh.paysplit.appfunctions.models.GroupListResult
import com.hanushh.paysplit.appfunctions.models.GroupResult
import com.hanushh.paysplit.appfunctions.models.MemberBalanceResult
import com.hanushh.paysplit.appfunctions.models.SettlementResult
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.int

/**
 * Exposes PaySplit functionality to Android's App Functions framework (API 36+).
 *
 * The system AI (Gemini) discovers and invokes these functions based on the
 * KDoc descriptions. All functions require the user to be signed in — they read
 * the Supabase access token from SharedPreferences (written by NativeTokenBridgeModule
 * whenever the JS auth session changes).
 *
 * All monetary amounts use cents (e.g. $12.50 = 1250) to avoid floating-point issues.
 */
class AppFunctionsService(private val context: Context) {

    private val client = SupabaseNativeClient(context)

    // ─────────────────────────────────────────────────────────────────────────
    // Read functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Returns all groups the signed-in user belongs to, along with their
     * current balance. A positive balanceCents means the user is owed money
     * in that group; negative means they owe money.
     *
     * @param appFunctionContext The App Function execution context.
     * @return A [GroupListResult] containing the list of groups and the user's
     *   aggregated balance across all groups.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun listGroups(
        appFunctionContext: AppFunctionContext,
    ): GroupListResult {
        val token = requireToken()

        // Fetch group memberships for the current user via JWT claim (RLS enforced)
        val membersRaw = client.from(
            table = "group_members",
            select = "group_id",
            filters = mapOf("user_id" to "not.is.null"),
            token = token,
        )
        val memberRows = client.parseJsonArray(membersRaw)
        val groupIds = memberRows.map { it["group_id"]!!.jsonPrimitive.content }

        if (groupIds.isEmpty()) {
            return GroupListResult(groups = emptyList(), totalBalanceCents = 0L)
        }

        // Fetch groups with their balances
        val groupsRaw = client.from(
            table = "groups",
            select = "id,name,archived,group_members(id),group_balances(balance_cents,currency_code)",
            filters = mapOf(
                "id" to "in.(${groupIds.joinToString(",")})",
                "archived" to "eq.false",
            ),
            token = token,
        )
        val groupRows = client.parseJsonArray(groupsRaw)

        val groups = groupRows.map { row ->
            val balanceRows = row["group_balances"]?.let {
                client.parseJsonArray(it.toString())
            } ?: emptyList()
            val primaryBalance = balanceRows.firstOrNull()
            val balanceCents = primaryBalance?.get("balance_cents")?.jsonPrimitive?.long ?: 0L
            val currency = primaryBalance?.get("currency_code")?.jsonPrimitive?.content ?: "USD"
            val memberCount = row["group_members"]?.let {
                client.parseJsonArray(it.toString()).size
            } ?: 0

            GroupResult(
                id = row["id"]!!.jsonPrimitive.content,
                name = row["name"]!!.jsonPrimitive.content,
                balanceCents = balanceCents,
                currencyCode = currency,
                memberCount = memberCount,
                isArchived = row["archived"]?.jsonPrimitive?.boolean ?: false,
            )
        }

        val totalBalance = groups.sumOf { it.balanceCents }
        return GroupListResult(groups = groups, totalBalanceCents = totalBalance)
    }

    /**
     * Returns the per-member balance breakdown for a specific group.
     * Useful for understanding exactly who owes whom before settling up.
     *
     * @param appFunctionContext The App Function execution context.
     * @param groupId The UUID of the group to fetch balances for.
     * @param groupName The display name of the group (for the result label).
     * @return A [GroupBalancesResult] with one entry per member showing their balance.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun getGroupBalances(
        appFunctionContext: AppFunctionContext,
        groupId: String,
        groupName: String,
    ): GroupBalancesResult {
        val token = requireToken()

        // Uses the RPC to get member balances with display names and avatars
        val raw = client.rpc(
            functionName = "get_group_member_balances",
            body = mapOf("p_group_id" to groupId),
            token = token,
        )

        val rows = client.parseRpcResult(raw)
        val balances = rows.map { row ->
            MemberBalanceResult(
                memberId = row["member_id"]!!.jsonPrimitive.content,
                displayName = row["display_name"]?.jsonPrimitive?.content ?: "Unknown",
                avatarUrl = row["avatar_url"]?.jsonPrimitive?.content ?: "",
                balanceCents = row["balance_cents"]?.jsonPrimitive?.long ?: 0L,
                currencyCode = row["currency_code"]?.jsonPrimitive?.content ?: "USD",
            )
        }

        return GroupBalancesResult(groupId = groupId, groupName = groupName, balances = balances)
    }

    /**
     * Returns the most recent activity (expenses and settlements) across all
     * of the user's groups.
     *
     * @param appFunctionContext The App Function execution context.
     * @param limit Maximum number of activity items to return (default: 20).
     * @return An [ActivityFeedResult] containing the recent activity items.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun getActivityFeed(
        appFunctionContext: AppFunctionContext,
        limit: Int = 20,
    ): ActivityFeedResult {
        val token = requireToken()

        val raw = client.rpc(
            functionName = "get_user_activity",
            body = mapOf("p_limit" to limit),
            token = token,
        )

        val rows = client.parseRpcResult(raw)
        val items = rows.map { row ->
            ActivityItem(
                id = row["id"]!!.jsonPrimitive.content,
                type = row["type"]?.jsonPrimitive?.content ?: "expense",
                groupId = row["group_id"]?.jsonPrimitive?.content ?: "",
                groupName = row["group_name"]?.jsonPrimitive?.content ?: "",
                description = row["description"]?.jsonPrimitive?.content ?: "",
                amountCents = row["amount_cents"]?.jsonPrimitive?.long ?: 0L,
                currencyCode = row["currency_code"]?.jsonPrimitive?.content ?: "USD",
                createdAt = row["created_at"]?.jsonPrimitive?.content ?: "",
            )
        }

        return ActivityFeedResult(items = items)
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Write functions
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Creates a new expense in a group and splits it among the specified members.
     * If splitAmountsCents is omitted, the amount is divided equally among all
     * members in splitMemberIds.
     *
     * @param appFunctionContext The App Function execution context.
     * @param groupId The UUID of the group this expense belongs to.
     * @param description What the expense was for (e.g. "Dinner at Nobu").
     * @param amountCents Total amount in cents (e.g. 8000 = $80.00).
     * @param currencyCode ISO 4217 currency code (e.g. "USD", "GBP").
     * @param paidByMemberId UUID of the group_members row for who paid.
     * @param splitMemberIds UUIDs of the group_members rows to split among.
     * @param splitAmountsCents Optional per-member amounts in cents. Must sum to
     *   amountCents. If omitted, the expense is split equally.
     * @param category Optional expense category (e.g. "food", "transport").
     * @return An [ExpenseResult] with the created expense's details.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun createExpense(
        appFunctionContext: AppFunctionContext,
        groupId: String,
        description: String,
        amountCents: Long,
        currencyCode: String,
        paidByMemberId: String,
        splitMemberIds: List<String>,
        splitAmountsCents: List<Long> = emptyList(),
        category: String = "general",
    ): ExpenseResult {
        val token = requireToken()

        val body = mutableMapOf<String, Any?>(
            "p_group_id" to groupId,
            "p_description" to description,
            "p_amount_cents" to amountCents,
            "p_currency_code" to currencyCode,
            "p_paid_by_member_id" to paidByMemberId,
            "p_split_member_ids" to splitMemberIds,
            "p_category" to category,
            "p_receipt_url" to null,
        )
        if (splitAmountsCents.isNotEmpty()) {
            body["p_split_amounts_cents"] = splitAmountsCents
        }

        val raw = client.rpc(
            functionName = "create_expense_with_splits",
            body = body,
            token = token,
        )

        // The RPC returns the created expense row
        val rows = client.parseRpcResult(raw)
        val row = rows.firstOrNull() ?: throw AppFunctionException("Expense creation returned no data")

        return ExpenseResult(
            expenseId = row["id"]!!.jsonPrimitive.content,
            groupId = groupId,
            description = description,
            amountCents = amountCents,
            currencyCode = currencyCode,
            category = category,
            paidByMemberId = paidByMemberId,
            splitCount = splitMemberIds.size,
            createdAt = row["created_at"]?.jsonPrimitive?.content ?: "",
        )
    }

    /**
     * Records a settlement payment between two members in a group.
     * This reduces the outstanding balance between the payer and payee.
     *
     * @param appFunctionContext The App Function execution context.
     * @param groupId The UUID of the group the settlement is within.
     * @param payeeMemberId UUID of the group_members row for the person being paid.
     * @param amountCents Settlement amount in cents.
     * @param currencyCode ISO 4217 currency code.
     * @param paymentMethod How payment was made: "cash", "venmo", or "other".
     * @param note Optional note about the payment.
     * @param payerMemberId Optional UUID of the payer's group_members row.
     *   If omitted, defaults to the current user's member record in the group.
     * @return A [SettlementResult] confirming the recorded payment.
     */
    @AppFunction(isDescribedByKDoc = true)
    suspend fun settleUp(
        appFunctionContext: AppFunctionContext,
        groupId: String,
        payeeMemberId: String,
        amountCents: Long,
        currencyCode: String,
        paymentMethod: String = "cash",
        note: String = "",
        payerMemberId: String = "",
    ): SettlementResult {
        val token = requireToken()

        val body = mutableMapOf<String, Any?>(
            "p_group_id" to groupId,
            "p_payee_member_id" to payeeMemberId,
            "p_amount_cents" to amountCents,
            "p_currency_code" to currencyCode,
            "p_payment_method" to paymentMethod,
        )
        if (note.isNotBlank()) body["p_note"] = note
        if (payerMemberId.isNotBlank()) body["p_payer_member_id"] = payerMemberId

        client.rpc(
            functionName = "record_settlement",
            body = body,
            token = token,
        )

        return SettlementResult(
            success = true,
            groupId = groupId,
            payerMemberId = payerMemberId,
            payeeMemberId = payeeMemberId,
            amountCents = amountCents,
            currencyCode = currencyCode,
            paymentMethod = paymentMethod,
        )
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private fun requireToken(): String {
        return client.getAccessToken()
            ?: throw AppFunctionException(
                "User is not signed in. Open PaySplit and sign in before using App Functions."
            )
    }
}
