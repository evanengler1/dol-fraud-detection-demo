"""DOL Fraud demo credit tracker.

Shows the credits used by the DOL Fraud Detection and Prevention app (Snowflake
App Runtime) and the DOL_FRAUD_AGENT CoWork agent. All numbers come from the
views in DOL_FRAUD_DEMO.COST (sql/14_credit_tracker.sql), which read
SNOWFLAKE.ACCOUNT_USAGE. Those views lag by up to about three hours.
"""

from datetime import date, timedelta

import altair as alt
import pandas as pd
import streamlit as st

st.set_page_config(
    page_title="DOL Fraud Demo Credit Tracker",
    page_icon=":material/payments:",
    layout="wide",
)

COST = "DOL_FRAUD_DEMO.COST"
# Default price per credit (USD) for dollar estimates. Set this to your contracted rate;
# users can also change it in the app.
DEFAULT_CREDIT_PRICE = 3.00
RANGES = {"7 days": 7, "30 days": 30, "90 days": 90, "All": None}
COMPONENT_LABELS = {"APP": "Fraud Prevention app", "AGENT": "CoWork agent", "SHARED": "Shared search"}
COMPONENT_COLORS = ["#0b2545", "#0e7c7b", "#d97706"]


# -----------------------------------------------------------------------------
# Data access
# -----------------------------------------------------------------------------
def get_conn():
    try:
        # In Snowflake this is the app's embedded session; locally it reads
        # [connections.snowflake] from .streamlit/secrets.toml.
        return st.connection("snowflake")
    except Exception as e:  # noqa: BLE001 - surface any connection failure
        st.error(f"Could not connect to Snowflake: {e}", icon=":material/error:")
        st.stop()


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    df.columns = [c.lower() for c in df.columns]
    for c in df.columns:
        if df[c].dtype == object and df[c].map(lambda v: hasattr(v, "as_tuple")).any():
            df[c] = df[c].astype(float)
    return df


@st.cache_data(ttl="15m", show_spinner=False)
def load_daily() -> pd.DataFrame:
    df = get_conn().query(f"SELECT * FROM {COST}.V_DAILY_CREDITS", ttl=0)
    df = _normalize(df)
    df["usage_date"] = pd.to_datetime(df["usage_date"])
    return df


@st.cache_data(ttl="15m", show_spinner=False)
def load_table(view: str) -> pd.DataFrame:
    allowed = {"V_AGENT_REQUESTS", "V_AGENT_MODEL_CREDITS", "V_WAREHOUSE_METERED", "V_APP_RUNTIME_POOL", "V_CONFIG"}
    if view not in allowed:
        raise ValueError(view)
    df = _normalize(get_conn().query(f"SELECT * FROM {COST}.{view}", ttl=0))
    for col in ("usage_date", "start_time"):
        if col in df.columns:
            df[col] = pd.to_datetime(df[col])
    return df


def in_range(df: pd.DataFrame, col: str, start: date | None) -> pd.DataFrame:
    if start is None or df.empty:
        return df
    return df[df[col].dt.date >= start]


def fmt(x: float) -> str:
    return f"{x:,.2f}" if abs(x) >= 0.01 or x == 0 else f"{x:,.4f}"


# -----------------------------------------------------------------------------
# Header and filters
# -----------------------------------------------------------------------------
st.title("DOL Fraud Demo Credit Tracker")
st.caption(
    "Credits used by the **Fraud Detection and Prevention app** and the **DOL_FRAUD_AGENT** "
    "CoWork agent. Source: `SNOWFLAKE.ACCOUNT_USAGE` (up to ~3 hours behind)."
)

page = st.segmented_control(
    "View", ["Actual usage", "Production scenario"], default="Actual usage", key="page",
    label_visibility="collapsed",
)

# Standard warehouse credits per hour. The scenario caps the rate at 2 (Small).
WH_RATES = {"X-Small": 1, "Small": 2}


def observed_rates(df: pd.DataFrame) -> dict:
    """Per-unit rates measured from the demo's own usage, used as scenario defaults."""
    llm = df[(df["component"] == "AGENT") & df["category"].str.startswith("LLM")]
    host = df[df["is_estimate"]]
    search = df[df["component"] == "SHARED"]
    per_day = lambda d: float(d["credits"].sum()) / max(d["usage_date"].nunique(), 1)  # noqa: E731
    reqs = float(llm["requests"].sum())
    return {
        "agent_per_request": float(llm["credits"].sum()) / reqs if reqs else 0.13,
        "hosting_per_day": per_day(host) if not host.empty else 0.2,
        "search_per_day": per_day(search) if not search.empty else 0.01,
    }


if page == "Production scenario":
    obs = observed_rates(load_daily())
    st.info(
        "This is an **estimate** of what the app and CoWork agent could cost to run in production for a team. "
        "Defaults come from this demo's measured usage; change any assumption to match your rollout.",
        title="Hypothetical production scenario", icon=":material/science:",
    )

    with st.container(border=True):
        st.subheader("Assumptions")
        c1, c2, c3 = st.columns(3)
        with c1:
            st.markdown("**Team and usage**")
            teams_txt = st.text_input("Team sizes to compare", "10, 15, 20", key="sc_teams",
                                      help="Comma-separated numbers of users.")
            q_per_user = st.number_input("Agent questions per user per workday", 0, 500, 10, key="sc_q")
            workdays = st.number_input("Workdays per month", 1, 31, 21, key="sc_days")
        with c2:
            st.markdown("**Agent and app**")
            cr_per_q = st.number_input(
                "Agent credits per question", 0.0, 10.0, round(obs["agent_per_request"], 4),
                step=0.01, format="%.4f", key="sc_crq",
                help=f"Measured in this demo: {obs['agent_per_request']:.4f} LLM credits per request "
                     "(CoWork + API). Longer, multi-tool questions cost more.",
            )
            host_day = st.number_input(
                "App hosting credits per day", 0.0, 100.0, round(obs["hosting_per_day"], 4),
                step=0.05, format="%.4f", key="sc_host",
                help="App Runtime runs around the clock whether or not anyone is using it. The default is "
                     "this app's equal-share estimate; a dedicated deployment may cost more.",
            )
            search_day = st.number_input(
                "Cortex Search credits per day", 0.0, 100.0, round(obs["search_per_day"], 4),
                step=0.01, format="%.4f", key="sc_search", help="Standing serving charge; does not scale with users.",
            )
        with c3:
            st.markdown("**Warehouse (queries from the app and agent)**")
            size = st.selectbox("Warehouse size", list(WH_RATES), index=0, key="sc_size")
            wh_rate = st.number_input(
                "Warehouse credits per hour", 0.0, 2.0, float(WH_RATES[size]), step=0.25, key=f"sc_rate_{size}",
                help="Standard rate for the selected size (maximum 2 credits per hour).",
            )
            base_hours = st.number_input("Active hours per workday", 0.0, 24.0, 6.0, step=0.5,
                                         key="sc_hours",
                                         help="Hours the warehouse is awake. It suspends after 60 s idle, but steady "
                                              "use through the day keeps it running.")
        sc_price = st.number_input("Credit price (USD per credit)", 0.0, 100.0, DEFAULT_CREDIT_PRICE,
                                   step=0.5, format="%.2f", key="sc_price",
                                   help="Use your contracted price per credit.")

    try:
        teams = sorted({int(t) for t in teams_txt.replace(" ", "").split(",") if t})
    except ValueError:
        st.error("Team sizes must be whole numbers separated by commas, for example 10, 15, 20.")
        st.stop()
    if not teams:
        st.stop()

    rows = []
    for n in teams:
        hours = base_hours
        agent = n * q_per_user * workdays * cr_per_q
        wh = hours * workdays * wh_rate
        hosting = host_day * 30
        search = search_day * 30
        rows += [
            {"users": n, "component": "CoWork agent (LLM)", "credits": agent},
            {"users": n, "component": "Warehouse (app + agent queries)", "credits": wh},
            {"users": n, "component": "App hosting", "credits": hosting},
            {"users": n, "component": "Cortex Search", "credits": search},
        ]
    sc = pd.DataFrame(rows)
    sc["usd"] = sc["credits"] * sc_price
    totals = sc.groupby("users", as_index=False)[["credits", "usd"]].sum()

    st.subheader("Estimated monthly cost")
    cards = st.columns(len(teams))
    for col, (_, r) in zip(cards, totals.iterrows()):
        col.metric(f"{int(r['users'])} users", f"${r['usd']:,.0f} / month", border=True, height="stretch",
                   help=f"{r['credits']:,.1f} credits per month; ${r['usd'] * 12:,.0f} per year.")
        col.caption(f"{r['credits']:,.1f} credits · ${r['usd'] * 12:,.0f} per year")

    l, r = st.columns([3, 2])
    with l:
        with st.container(border=True):
            st.markdown("**Monthly cost by component**")
            st.altair_chart(
                alt.Chart(sc).mark_bar().encode(
                    x=alt.X("users:O", title="Team size (users)"),
                    y=alt.Y("sum(usd):Q", title="USD per month"),
                    color=alt.Color("component:N", title=None, legend=alt.Legend(orient="top"),
                                    scale=alt.Scale(range=["#0e7c7b", "#0b2545", "#d97706", "#6b6b70"])),
                    tooltip=["users:O", "component:N", alt.Tooltip("sum(credits):Q", title="Credits", format=",.1f"),
                             alt.Tooltip("sum(usd):Q", title="USD", format="$,.0f")],
                ).properties(height=320)
            )
    with r:
        with st.container(border=True):
            st.markdown("**Detail**")
            table = sc.pivot_table(index="component", columns="users", values="usd", aggfunc="sum")
            table.columns = [f"{c} users" for c in table.columns]
            table.loc["Total"] = table.sum()
            st.dataframe(table, column_config={c: st.column_config.NumberColumn(c, format="$%,.0f") for c in table.columns})
            st.caption(
                "Agent costs grow with the team. Warehouse hours, app hosting and search are fixed: they run "
                "whether 1 or 100 people use them. Months are 30 days for fixed costs."
            )

    st.caption(
        ":material/info: Not included: building the data pipelines (sql/01-13), storage, data refreshes and "
        "development work. Actual cost depends on question complexity, data volume and warehouse sizing."
    )
    st.stop()

with st.container(horizontal=True, vertical_alignment="bottom"):
    range_label = st.segmented_control("Period", list(RANGES), default="30 days", key="period")
    include_est = st.toggle("Include App Runtime hosting estimate", value=True, key="include_est")
    price = st.number_input(
        "Credit price (USD per credit)", min_value=0.0, value=DEFAULT_CREDIT_PRICE, step=0.5, format="%.2f", key="price",
        help="Enter your contracted price per credit. Dollar amounts then appear in a cost row under the "
             "credit cards, in the breakdown table, and in the chart tooltips.",
    )
    if st.button("Refresh", icon=":material/refresh:"):
        st.cache_data.clear()
        st.rerun()

days = RANGES[range_label or "30 days"]
start = date.today() - timedelta(days=days - 1) if days else None

with st.spinner("Loading usage..."):
    daily_all = load_daily()

daily = in_range(daily_all, "usage_date", start)
if not include_est:
    daily = daily[~daily["is_estimate"]]

if daily.empty:
    st.info("No usage recorded in this period yet. Usage views can lag by up to three hours.", icon=":material/hourglass:")
    st.stop()

# -----------------------------------------------------------------------------
# KPIs
# -----------------------------------------------------------------------------
by_comp = daily.groupby("component")["credits"].sum()
total = float(by_comp.sum())
app_c, agent_c, shared_c = (float(by_comp.get(k, 0.0)) for k in ("APP", "AGENT", "SHARED"))
est_c = float(daily.loc[daily["is_estimate"], "credits"].sum())

req = in_range(load_table("V_AGENT_REQUESTS"), "start_time", start)
n_req = int(req["request_id"].nunique()) if not req.empty else 0


def usd(c: float) -> str:
    return f"${c * price:,.2f}"


cols = st.columns(5)
cols[0].metric("Total credits", fmt(total), help="App + agent + shared search for the period.",
               border=True, height="stretch")
cols[1].metric("Fraud Prevention app", fmt(app_c), border=True, height="stretch",
               help=f"Includes {fmt(est_c)} estimated App Runtime hosting." if include_est else "Exact query compute only.")
cols[2].metric("CoWork agent", fmt(agent_c), border=True, height="stretch",
               help="LLM tokens (CoWork and API) plus the SQL its tools ran.")
cols[3].metric("Shared search", fmt(shared_c), border=True, height="stretch",
               help="Daily serving charge for the 3 Cortex Search services used by both.")
cols[4].metric("Agent requests", f"{n_req:,}", border=True, height="stretch",
               help="Distinct agent requests (CoWork chats and API calls).")
if price > 0:
    st.markdown(f"**Estimated cost** at ${price:,.2f} per credit")
    cost = st.columns(5)
    cost[0].metric("Total cost", usd(total), border=True, height="stretch")
    cost[1].metric("Fraud Prevention app", usd(app_c), border=True, height="stretch")
    cost[2].metric("CoWork agent", usd(agent_c), border=True, height="stretch")
    cost[3].metric("Shared search", usd(shared_c), border=True, height="stretch")
    cost[4].metric("Cost per agent request", usd(agent_c / n_req) if n_req else "n/a",
                   border=True, height="stretch", help="Agent credits for the period divided by agent requests.")
else:
    st.caption(":material/attach_money: Enter a credit price above to see these figures in US dollars.")
if include_est and est_c > 0:
    st.caption(
        ":material/info: App Runtime hosting is an **estimate**: all apps share one Snowflake-managed pool and "
        "Snowflake does not report credits per app, so each hour is split equally across the running apps."
    )

# -----------------------------------------------------------------------------
# Trend and breakdown
# -----------------------------------------------------------------------------
left, right = st.columns([3, 2])
with left:
    with st.container(border=True):
        st.subheader("Daily credits")
        trend = daily.groupby(["usage_date", "component"], as_index=False)["credits"].sum()
        trend["component"] = trend["component"].map(COMPONENT_LABELS)
        trend["usd"] = trend["credits"] * price
        tooltip = [
            alt.Tooltip("yearmonthdate(usage_date):T", title="Date"),
            alt.Tooltip("component:N", title="Component"),
            alt.Tooltip("sum(credits):Q", title="Credits", format=",.4f"),
        ]
        if price > 0:
            tooltip.append(alt.Tooltip("sum(usd):Q", title="Est. cost (USD)", format="$,.2f"))
        chart = (
            alt.Chart(trend)
            .mark_bar()
            .encode(
                x=alt.X("yearmonthdate(usage_date):T", title=None),
                y=alt.Y("sum(credits):Q", title="Credits"),
                color=alt.Color(
                    "component:N", title=None,
                    scale=alt.Scale(domain=list(COMPONENT_LABELS.values()), range=COMPONENT_COLORS),
                    legend=alt.Legend(orient="top"),
                ),
                tooltip=tooltip,
            )
            .properties(height=320)
        )
        st.altair_chart(chart)

with right:
    with st.container(border=True):
        st.subheader("Where the credits go")
        cat = (
            daily.groupby(["component", "category", "is_estimate"], as_index=False)["credits"].sum()
            .sort_values("credits", ascending=False)
        )
        cat["component"] = cat["component"].map(COMPONENT_LABELS)
        cat["share"] = cat["credits"] / total if total else 0.0
        cat["usd"] = cat["credits"] * price
        st.dataframe(
            cat,
            hide_index=True,
            column_order=["component", "category", "credits"] + (["usd"] if price > 0 else [])
            + ["share", "is_estimate"],
            column_config={
                "component": "Component",
                "category": "Category",
                "credits": st.column_config.NumberColumn("Credits", format="%.4f"),
                "usd": st.column_config.NumberColumn("Est. cost (USD)", format="$%.2f"),
                "share": st.column_config.ProgressColumn("Share", format="percent", min_value=0, max_value=1),
                "is_estimate": st.column_config.CheckboxColumn("Estimate"),
            },
        )

# -----------------------------------------------------------------------------
# Detail views
# -----------------------------------------------------------------------------
view = st.segmented_control(
    "Detail", ["Agent", "App", "How this is measured"], default="Agent", key="detail",
)

if view == "Agent":
    a1, a2 = st.columns(2)
    with a1:
        with st.container(border=True):
            st.subheader("Requests by channel")
            if req.empty:
                st.caption("No agent requests in this period.")
            else:
                ch = req.groupby("channel", as_index=False).agg(
                    requests=("request_id", "nunique"), credits=("credits", "sum"), tokens=("tokens", "sum"),
                )
                ch["credits_per_request"] = ch["credits"] / ch["requests"]
                st.dataframe(
                    ch, hide_index=True,
                    column_config={
                        "channel": "Channel",
                        "requests": st.column_config.NumberColumn("Requests", format="%d"),
                        "credits": st.column_config.NumberColumn("LLM credits", format="%.4f"),
                        "tokens": st.column_config.NumberColumn("Tokens", format="%d"),
                        "credits_per_request": st.column_config.NumberColumn("Credits / request", format="%.4f"),
                    },
                )
                st.caption("CoWork = chats in Snowflake Intelligence. API = REST or DATA_AGENT_RUN calls.")
    with a2:
        with st.container(border=True):
            st.subheader("CoWork credits by model")
            models = in_range(load_table("V_AGENT_MODEL_CREDITS"), "usage_date", start)
            if models.empty:
                st.caption("No CoWork usage in this period.")
            else:
                m = models.groupby(["model_name", "service_type"], as_index=False)["credits"].sum()
                st.dataframe(
                    m.sort_values("credits", ascending=False), hide_index=True,
                    column_config={
                        "model_name": "Model", "service_type": "Service",
                        "credits": st.column_config.NumberColumn("Credits", format="%.4f"),
                    },
                )
    with st.container(border=True):
        st.subheader("Most expensive agent requests")
        if req.empty:
            st.caption("No agent requests in this period.")
        else:
            st.dataframe(
                req.sort_values("credits", ascending=False).head(25), hide_index=True,
                column_order=["start_time", "channel", "user_name", "credits", "tokens", "request_id"],
                column_config={
                    "start_time": st.column_config.DatetimeColumn("Time", format="YYYY-MM-DD HH:mm"),
                    "channel": "Channel", "user_name": "User",
                    "credits": st.column_config.NumberColumn("Credits", format="%.4f"),
                    "tokens": st.column_config.NumberColumn("Tokens", format="%d"),
                    "request_id": "Request ID",
                },
            )

elif view == "App":
    cfg = load_table("V_CONFIG")
    app_count = int(cfg["app_count"].iloc[0]) if not cfg.empty else 1
    pool = in_range(load_table("V_APP_RUNTIME_POOL"), "usage_date", start)
    wh = in_range(load_table("V_WAREHOUSE_METERED"), "usage_date", start)
    app_rows = daily[daily["component"] == "APP"]
    q_cr = float(app_rows.loc[~app_rows["is_estimate"], "credits"].sum())
    h_cr = float(app_rows.loc[app_rows["is_estimate"], "credits"].sum())

    b1, b2, b3 = st.columns(3)
    b1.metric("Query compute (exact)", fmt(q_cr), border=True, height="stretch",
              help="Queries run by the app's service user on DOL_FRAUD_WH.")
    b2.metric("Hosting (estimate)", fmt(h_cr) if include_est else "hidden", border=True, height="stretch",
              help=f"Account App Runtime pool credits divided by {app_count} running apps.")
    b3.metric("App Runtime pool, all apps", fmt(float(pool["credits"].sum())), border=True, height="stretch",
              help="Total for every App Runtime app in the account, for context.")

    with st.container(border=True):
        st.subheader("DOL_FRAUD_WH: attributed vs metered")
        attributed = (
            daily[daily["category"].isin(["Query compute (warehouse)", "Tool SQL (warehouse)"])]
            .groupby("usage_date", as_index=False)["credits"].sum().assign(series="App + agent queries")
        )
        metered = wh.assign(series="Warehouse metered (all use, incl. idle)")
        both = pd.concat([attributed, metered[["usage_date", "credits", "series"]]])
        st.altair_chart(
            alt.Chart(both).mark_line(point=True).encode(
                x=alt.X("yearmonthdate(usage_date):T", title=None),
                y=alt.Y("credits:Q", title="Credits"),
                color=alt.Color("series:N", title=None, legend=alt.Legend(orient="top"),
                                scale=alt.Scale(range=["#0e7c7b", "#6b6b70"])),
                tooltip=["yearmonthdate(usage_date):T", "series:N", alt.Tooltip("credits:Q", format=",.4f")],
            ).properties(height=280)
        )
        st.caption(
            "Metered warehouse credits also include data pipeline runs, ad hoc analysis and idle time "
            "before auto-suspend. Only queries from the app and the agent are counted above."
        )

else:
    st.markdown(
        """
| Component | Category | Source view | Basis |
|---|---|---|---|
| CoWork agent | LLM tokens (CoWork) | `SNOWFLAKE_COWORK_USAGE_HISTORY` | Exact, filtered to `DOL_FRAUD_AGENT` |
| CoWork agent | LLM tokens (API) | `CORTEX_AGENT_USAGE_HISTORY` | Exact; no request overlap with CoWork |
| CoWork agent | Tool SQL (warehouse) | `QUERY_ATTRIBUTION_HISTORY` | Exact; queries tagged `snowflake-intelligence-*` or `cortex-agent-*` on `DOL_FRAUD_WH` |
| Fraud Prevention app | Query compute (warehouse) | `QUERY_ATTRIBUTION_HISTORY` | Exact; queries by the app's `SNOWFLAKE_SERVICE` user on `DOL_FRAUD_WH` |
| Fraud Prevention app | App Runtime hosting | `SNOWFLAKE_APP_RUNTIME_COMPUTE_HISTORY` | **Estimate**: hourly pool credits ÷ running apps (`COST.TRACKER_CONFIG`) |
| Shared search | Cortex Search serving | `CORTEX_SEARCH_DAILY_USAGE_HISTORY` | Exact daily charge for the services in `DOL_FRAUD_DEMO` |
"""
    )
    st.info(
        "Query attribution excludes warehouse idle time and short queries (under ~100 ms), so warehouse totals "
        "here are lower than metered totals. Account usage views lag by up to three hours. Rerun section 2 of "
        "`sql/14_credit_tracker.sql` when apps are added to or removed from the account.",
        icon=":material/info:",
    )
