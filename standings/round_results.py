import logging

from django.db.models.expressions import RawSQL

from results.models import TeamScore, SpeakerScore
from participants.models import Team


logger = logging.getLogger(__name__)


def add_team_round_results(standings, rounds, lookup=None):
    """Sets, on each item `info` in `standings`, an attribute
    `info.round_results` to be a list of `TeamScore` objects, one for each round
    in `rounds` (in the same order), relating to the team associated with that
    item.

    If, for some team and round, there is no relevant `TeamScore`, then the
    corresponding element of `info.round_results` will be `None`. Additionally,
    each `TeamScore` object `ts` in each `s.round_results` will have an
    attribute `ts.opposition`, which will be a `Team` object representing the
    team faced by the team relating to `info` in the corresponding round.

    If `lookup` is given, it should be a function that takes two arguments
    `(standings, x)` and returns the element in `standings` relating to the
    `Team` object `x`.  By default, it just uses `standings.get_standings(x)`.
    """

    if lookup is None:
        lookup = lambda standings, x: standings.get_standing(x)

    teams = [info.instance_id for info in standings]
    teamscores = TeamScore.objects.select_related(
        'debate_team__team', 'debate_team__debate__round').filter(
        ballot_submission__confirmed=True,
        debate_team__debate__round__in=rounds,
        debate_team__team_id__in=teams
    )
    teamscores = teamscores.annotate(opposition_id=RawSQL("""
        SELECT opposition.team_id
        FROM draw_debateteam AS opposition
        WHERE opposition.debate_id = draw_debateteam.debate_id
        AND opposition.id != draw_debateteam.id""", ()
    ))
    teamscores = list(teamscores)
    oppositions = Team.objects.in_bulk([ts.opposition_id for ts in teamscores])

    for info in standings:
        info.round_results = [None] * len(rounds)

    round_lookup = {r: i for i, r in enumerate(rounds)}
    for ts in teamscores:
        ts.opposition = oppositions[ts.opposition_id]
        info = lookup(standings, ts.debate_team.team)
        info.round_results[round_lookup[ts.debate_team.debate.round]] = ts


def add_team_round_results_public(teams, rounds):
    """Sets, on each item `t` in `teams`, the following attributes:
      - `t.round_results`, a list of `TeamScore` objects, one for each round in
        `rounds` (in the same order), relating to the team `t`. The `TeamScore`
        objects are also annotated with oppositions, and as provided for in
        `add_team_round_results()`.
      - `t.wins`, the number of wins that team has from the rounds in `rounds`
      - `t.points`, the number of points that team has from the rounds in
        `rounds`.
    """
    add_team_round_results(teams, rounds, (lambda teams, x: [t for t in teams if t == x][0]))
    for team in teams:
        team.wins = [ts.win for ts in team.round_results if ts].count(True)
        team.points = sum([ts.points for ts in team.round_results if ts])


def add_speaker_round_results(standings, rounds, tournament, replies=False):
    """Sets, on each item `info` in `standings`, an attribute `info.scores` to
    be a list of ints, one for each round in `rounds`, each being the score
    received by the speaker associated with `info` in the corresponding round.
    If there is no score available for a speaker and round, the corresponding
    element will be `None`.
    """

    speaker_ids = [info.instance_id for info in standings]
    speaker_scores = SpeakerScore.objects.select_related('speaker',
        'ballot_submission', 'debate_team__debate__round').filter(
        ballot_submission__confirmed=True, debate_team__debate__round__in=rounds,
        speaker_id__in=speaker_ids)

    if replies:
        speaker_scores = speaker_scores.filter(position=tournament.REPLY_POSITION)
    else:
        speaker_scores = speaker_scores.filter(position__lte=tournament.LAST_SUBSTANTIVE_POSITION)

    for info in standings:
        info.scores = [None] * len(rounds)

    round_lookup = {r: i for i, r in enumerate(rounds)}
    for ss in speaker_scores:
        info = standings.get_standing(ss.speaker)
        info.scores[round_lookup[ss.debate_team.debate.round]] = ss.score
